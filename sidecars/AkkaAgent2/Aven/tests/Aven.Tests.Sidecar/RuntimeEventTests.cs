using System.Collections.Concurrent;
using Aven.Api.Runtime;
using Aven.Contracts.Identifiers;
using Aven.Events.Interfaces;
using Aven.Events.Models;
using Aven.RoleAgents.Contracts.Ledger;
using Aven.Sidecar;
using Aven.Sidecar.Protocol;
using Aven.Toolkit.Core.Identifiers;
using Microsoft.Extensions.Configuration;

namespace Aven.Tests.Sidecar;

/// <summary>Deterministic mapping/correlation tests for the M8 event projector (no runtime).</summary>
public sealed class RuntimeEventProjectorTests
{
    private static EventMetadata MetaFor(string correlationId) => new(
        EventId: "evt-1",
        EventType: "test",
        EventVersion: 1,
        ActorAddress: new ActorAddress("agent/x", "local"),
        ActorKind: "RoleAgentActor",
        CommandId: null,
        DeliveryId: null,
        OperationKey: null,
        CorrelationId: new CorrelationId(correlationId),
        CausationId: null,
        PayloadHash: "hash",
        OccurredAt: DateTimeOffset.UnixEpoch);

    private static RuntimeEventProjector ProjectorWith(out RuntimeEventCorrelation correlation)
    {
        correlation = new RuntimeEventCorrelation();
        var output = new OutputChannel(new MemoryStream(), new SidecarLogger(TextWriter.Null));
        return new RuntimeEventProjector(output, correlation);
    }

    [Fact]
    public void Projects_run_completed_to_message_completed_with_reply_id()
    {
        var projector = ProjectorWith(out var correlation);
        correlation.Register("corr-msg-1", new ReplyCorrelation("reply-1", "msg-1", "ident-1"));

        var envelope = new AvenEventEnvelope<RunCompleted>(
            MetaFor("corr-msg-1"),
            new RunCompleted(new RunId("run-1"), "All done.", null, DateTimeOffset.UnixEpoch));

        var projected = projector.Project(envelope);

        Assert.NotNull(projected);
        Assert.Equal(ProtocolEvents.AgentMessageCompleted, projected!.Value.Method);
        Assert.Equal("reply-1", projected.Value.Payload["replyId"]!.GetValue<string>());
        Assert.Equal("All done.", projected.Value.Payload["text"]!.GetValue<string>());
        Assert.Equal("run-1", projected.Value.Payload["runId"]!.GetValue<string>());
    }

    [Fact]
    public void Projects_run_failed_to_run_failed_event()
    {
        var projector = ProjectorWith(out var correlation);
        correlation.Register("corr-msg-2", new ReplyCorrelation("reply-2", "msg-2", "ident-1"));

        var envelope = new AvenEventEnvelope<RunFailed>(
            MetaFor("corr-msg-2"),
            new RunFailed(new RunId("run-2"), "provider missing", DateTimeOffset.UnixEpoch));

        var projected = projector.Project(envelope);

        Assert.NotNull(projected);
        Assert.Equal(ProtocolEvents.AgentRunFailed, projected!.Value.Method);
        Assert.Equal("reply-2", projected.Value.Payload["replyId"]!.GetValue<string>());
        Assert.Equal("provider missing", projected.Value.Payload["message"]!.GetValue<string>());
    }

    [Fact]
    public void Projects_run_started_with_correlation_ids()
    {
        var projector = ProjectorWith(out var correlation);
        correlation.Register("corr-msg-3", new ReplyCorrelation("reply-3", "msg-3", "ident-9"));

        var envelope = new AvenEventEnvelope<RunStarted>(
            MetaFor("corr-msg-3"),
            new RunStarted(new RunId("run-3"), new WorkItemId("wi-3"), new RoleAgentId("agent-3"), "do it", DateTimeOffset.UnixEpoch));

        var projected = projector.Project(envelope);

        Assert.NotNull(projected);
        Assert.Equal(ProtocolEvents.AgentRunStarted, projected!.Value.Method);
        Assert.Equal("reply-3", projected.Value.Payload["replyId"]!.GetValue<string>());
        Assert.Equal("msg-3", projected.Value.Payload["messageId"]!.GetValue<string>());
        Assert.Equal("ident-9", projected.Value.Payload["identityId"]!.GetValue<string>());
        Assert.Equal("agent-3", projected.Value.Payload["agentId"]!.GetValue<string>());
    }

    [Fact]
    public void Ignores_events_without_a_registered_correlation()
    {
        var projector = ProjectorWith(out _);
        var envelope = new AvenEventEnvelope<RunCompleted>(
            MetaFor("corr-unknown"),
            new RunCompleted(new RunId("run-x"), "x", null, DateTimeOffset.UnixEpoch));

        Assert.Null(projector.Project(envelope));
    }
}

/// <summary>
/// Verifies the runtime event hook actually delivers durable envelopes to a subscriber, and
/// (when a submit is accepted) that the submit's correlation threads onto the run events.
/// </summary>
public sealed class RuntimeEventFlowTests : IAsyncLifetime
{
    private string _tempDir = string.Empty;
    private RuntimeCompositionRoot _runtime = null!;

    public Task InitializeAsync()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "aven-sidecar-m8", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Aven:Persistence:SqlitePath"] = Path.Combine(_tempDir, "runtime.sqlite"),
                ["Aven:Trace:SqlitePath"] = Path.Combine(_tempDir, "trace.sqlite"),
                ["Aven:Artifacts:BlobRoot"] = Path.Combine(_tempDir, "blobs"),
            })
            .Build();
        _runtime = new RuntimeCompositionRoot(config);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _runtime.OnRuntimeEvent(null);
        await _runtime.DisposeAsync();
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    [Fact]
    public async Task Runtime_event_hook_delivers_durable_envelopes()
    {
        var received = new ConcurrentQueue<IAvenEventEnvelope>();
        _runtime.OnRuntimeEvent(received.Enqueue);

        // Registering + starting a role agent persists events to the durable stream.
        _runtime.RegisterAgent(new Aven.Api.Requests.CreateAgentRequest(
            RoleAgentId: "agent-m8-1",
            RoleName: "accountant",
            DisplayName: "M8 Agent",
            Objective: "event flow",
            ResponsibilityScope: "tests"));

        for (var i = 0; i < 50 && received.IsEmpty; i++)
        {
            await Task.Delay(100);
        }

        Assert.False(received.IsEmpty);
        // Every envelope exposes the correlation field the projector keys on.
        Assert.All(received, e => Assert.NotNull(e.Meta.CorrelationId.Value));
    }
}
