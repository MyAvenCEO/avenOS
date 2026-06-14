using System.Text.Json.Nodes;
using Aven.Api.Runtime;
using Aven.Sidecar.Protocol;

namespace Aven.Sidecar;

/// <summary>
/// The private stdio sidecar host. Reads <c>Content-Length</c> framed requests from
/// stdin, dispatches them into <see cref="RuntimeCompositionRoot"/>, and writes framed
/// responses/events to stdout. Logs go only to stderr. stdout is kept protocol-only by
/// redirecting <see cref="Console.Out"/> to stderr before anything else runs, so stray
/// writes (including Akka's StandardOutLogger) cannot corrupt the wire.
/// </summary>
public static class SidecarHost
{
    public static async Task<int> RunAsync(string[] args)
    {
        // 1. Capture the REAL stdout for protocol frames, then steer Console to stderr.
        var protocolStdout = Console.OpenStandardOutput();
        var stderrWriter = new StreamWriter(Console.OpenStandardError()) { AutoFlush = true };
        Console.SetOut(stderrWriter);
        Console.SetError(stderrWriter);

        var logger = new SidecarLogger(stderrWriter);
        await using var output = new OutputChannel(protocolStdout, logger);

        var once = args.Contains("--once") || args.Contains("--smoke");
        logger.Info($"{SidecarInfo.ServerName} {SidecarInfo.ServerVersion} starting (pid {Environment.ProcessId}){(once ? " [once]" : string.Empty)}");

        // 2. Build the durable runtime. Construction is crash-safe (the runtime defaults any
        //    missing config), but we still capture failure as structured health, not a crash.
        RuntimeCompositionRoot? runtime = null;
        string? startupError = null;
        try
        {
            var configuration = SidecarConfiguration.Build(logger);
            runtime = new RuntimeCompositionRoot(configuration);
            logger.Info("runtime composition root started");
        }
        catch (Exception ex)
        {
            startupError = ex.Message;
            logger.Error("runtime failed to start", ex);
        }

        // 3. Announce health on startup (spec §13.1 step 5).
        await output.EmitEventAsync(ProtocolEvents.RuntimeHealth, new JsonObject
        {
            ["status"] = runtime is not null ? "ready" : "error",
            ["server"] = SidecarInfo.ServerName,
            ["version"] = SidecarInfo.ServerVersion,
            ["protocolVersion"] = ProtocolConstants.Version,
            ["message"] = startupError,
        });

        // Live event projection (M8): tap the runtime event stream and forward correlated
        // run/operation/human-prompt events to the webview.
        var correlation = new RuntimeEventCorrelation();
        var projector = new RuntimeEventProjector(output, correlation);
        runtime?.OnRuntimeEvent(projector.Handle);

        var dispatcher = new MethodDispatcher(runtime, startupError, logger, correlation);
        dispatcher.ShutdownRequested += () => logger.Info("session.shutdown requested");

        // 4. Serve.
        var input = Console.OpenStandardInput();
        var reader = new FrameReader(input);
        var inflight = new List<Task>();

        try
        {
            while (true)
            {
                ProtocolEnvelope? envelope;
                try
                {
                    envelope = await reader.ReadEnvelopeAsync().ConfigureAwait(false);
                }
                catch (ProtocolFramingException ex)
                {
                    // A malformed frame is unrecoverable for this stream position; the spec
                    // requires stdout/stdin be protocol-only, so we stop rather than guess.
                    logger.Error("protocol framing error; closing input", ex);
                    break;
                }

                if (envelope is null)
                {
                    logger.Info("stdin reached EOF; shutting down");
                    break;
                }

                if (!ProtocolValidation.TryValidate(envelope, out var validationError))
                {
                    if (!string.IsNullOrEmpty(envelope.Id))
                    {
                        await output.SendAsync(ProtocolEnvelope.ResponseError(
                            envelope.Id, new ProtocolError(ProtocolErrorCodes.InvalidRequest, validationError!)));
                    }
                    else
                    {
                        logger.Warn($"dropping invalid envelope: {validationError}");
                    }

                    continue;
                }

                if (envelope.Kind != ProtocolKind.Request)
                {
                    logger.Warn($"ignoring inbound non-request envelope (kind={envelope.Kind})");
                    continue;
                }

                // Shutdown is handled inline so its response is flushed before we exit.
                if (envelope.Method == ProtocolMethods.SessionShutdown)
                {
                    var response = await dispatcher.DispatchAsync(envelope).ConfigureAwait(false);
                    await output.SendAsync(response).ConfigureAwait(false);
                    break;
                }

                // Everything else runs concurrently; responses carry their own id, so the
                // Rust side correlates them regardless of completion order.
                var captured = envelope;
                inflight.Add(Task.Run(async () =>
                {
                    var response = await dispatcher.DispatchAsync(captured).ConfigureAwait(false);
                    await output.SendAsync(response).ConfigureAwait(false);
                }));
                inflight.RemoveAll(t => t.IsCompleted);

                if (once)
                {
                    break;
                }
            }

            await DrainInflightAsync(inflight, logger).ConfigureAwait(false);
        }
        finally
        {
            if (runtime is not null)
            {
                logger.Info("draining runtime");
                runtime.OnRuntimeEvent(null);
                try
                {
                    await runtime.DisposeAsync().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    logger.Error("error draining runtime", ex);
                }
            }

            await stderrWriter.FlushAsync().ConfigureAwait(false);
        }

        logger.Info("sidecar exited cleanly");
        return 0; // a degraded runtime is still a clean process exit
    }

    private static async Task DrainInflightAsync(List<Task> inflight, SidecarLogger logger)
    {
        var pending = inflight.Where(t => !t.IsCompleted).ToArray();
        if (pending.Length == 0)
        {
            return;
        }

        logger.Info($"waiting for {pending.Length} in-flight request(s) to finish");
        // Bounded: never block shutdown indefinitely on a wedged request.
        await Task.WhenAny(Task.WhenAll(pending), Task.Delay(TimeSpan.FromSeconds(10))).ConfigureAwait(false);
    }
}
