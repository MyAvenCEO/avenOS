using Aven.Sidecar.Protocol;

namespace Aven.Sidecar;

/// <summary>
/// The single writer for protocol frames on stdout. Responses (possibly produced
/// concurrently by several in-flight requests) and server-originated events all funnel
/// through here, serialized by a semaphore so frames never interleave on the wire.
/// </summary>
public sealed class OutputChannel(Stream stdout, SidecarLogger logger) : IAsyncDisposable
{
    private readonly Stream _stdout = stdout;
    private readonly SidecarLogger _logger = logger;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public async Task SendAsync(ProtocolEnvelope envelope, CancellationToken cancellationToken = default)
    {
        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await MessageFraming.WriteAsync(_stdout, envelope, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // stdout is the lifeline; if it breaks the parent is gone. Log and let the
            // read loop notice EOF and shut down.
            _logger.Error("failed to write protocol frame to stdout", ex);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    /// <summary>Emit a server-originated event envelope.</summary>
    public Task EmitEventAsync(string method, System.Text.Json.Nodes.JsonNode? payload, CancellationToken cancellationToken = default) =>
        SendAsync(ProtocolEnvelope.EventMessage(method, payload), cancellationToken);

    public async ValueTask DisposeAsync()
    {
        _writeLock.Dispose();
        await _stdout.FlushAsync().ConfigureAwait(false);
    }
}
