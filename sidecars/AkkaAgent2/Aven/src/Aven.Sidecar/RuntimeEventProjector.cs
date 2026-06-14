using System.Text.Json.Nodes;
using Aven.Contracts.Protocol;
using Aven.Events.Interfaces;
using Aven.Resources.Human.Contracts.Events;
using Aven.RoleAgents.Contracts.Ledger;
using Aven.Sidecar.Protocol;

namespace Aven.Sidecar;

/// <summary>
/// Projects durable runtime event envelopes (run/operation/human-prompt lifecycle) into
/// correlated sidecar protocol events for live UI (milestone plan M8). Subscribed via
/// <c>RuntimeCompositionRoot.OnRuntimeEvent</c>; every event is keyed back to the app reply
/// id through <see cref="RuntimeEventCorrelation"/>. Events the sidecar didn't originate
/// (no known correlation) are ignored. Emission is best-effort (spec §9.2: events for
/// immediacy, methods for truth).
/// </summary>
public sealed class RuntimeEventProjector(OutputChannel output, RuntimeEventCorrelation correlation)
{
    private readonly OutputChannel _output = output;
    private readonly RuntimeEventCorrelation _correlation = correlation;

    public void Handle(IAvenEventEnvelope envelope)
    {
        var projected = Project(envelope);
        if (projected is { } p)
        {
            _ = _output.EmitEventAsync(p.Method, p.Payload);
        }

        // Drop the correlation once the run reaches a terminal state.
        if (envelope.Data is RunCompleted or RunFailed)
        {
            _correlation.Forget(envelope.Meta.CorrelationId.Value);
        }
    }

    /// <summary>
    /// Resolve the correlated UI event for an envelope, or <c>null</c> if it isn't a
    /// sidecar-originated turn or doesn't map to a UI event. Pure (no I/O) for testability.
    /// </summary>
    public (string Method, JsonNode Payload)? Project(IAvenEventEnvelope envelope)
    {
        var reply = _correlation.Resolve(envelope.Meta.CorrelationId.Value);
        if (reply is null)
        {
            return null;
        }

        var (method, payload) = Map(envelope.Data, reply);
        return method is not null && payload is not null ? (method, payload) : null;
    }

    private static (string?, JsonNode?) Map(IAvenEvent data, ReplyCorrelation reply) => data switch
    {
        RunStarted r => (ProtocolEvents.AgentRunStarted, new JsonObject
        {
            ["identityId"] = reply.IdentityId,
            ["messageId"] = reply.MessageId,
            ["replyId"] = reply.ReplyId,
            ["runId"] = r.RunId.Value,
            ["agentId"] = r.RoleAgentId.Value,
        }),
        RunCompleted r => (ProtocolEvents.AgentMessageCompleted, new JsonObject
        {
            ["replyId"] = reply.ReplyId,
            ["runId"] = r.RunId.Value,
            ["text"] = r.Summary,
            ["finishReason"] = "completed",
        }),
        RunFailed r => (ProtocolEvents.AgentRunFailed, new JsonObject
        {
            ["replyId"] = reply.ReplyId,
            ["message"] = r.Reason,
            ["code"] = "run_failed",
        }),
        OperationRequested o => (ProtocolEvents.AgentToolStarted, new JsonObject
        {
            ["replyId"] = reply.ReplyId,
            ["toolId"] = o.OperationId.Value,
            ["name"] = o.OperationKey.OperationType,
            ["label"] = ToolLabel(o.OperationKey.OperationType),
        }),
        OperationCompleted o => (ProtocolEvents.AgentToolCompleted, new JsonObject
        {
            ["replyId"] = reply.ReplyId,
            ["toolId"] = o.OperationId.Value,
            ["label"] = ToolLabel(o.OperationKey.OperationType),
            ["ok"] = true,
        }),
        OperationFailed o => (ProtocolEvents.AgentToolCompleted, new JsonObject
        {
            ["replyId"] = reply.ReplyId,
            ["toolId"] = o.OperationId.Value,
            ["label"] = ToolLabel(o.OperationKey.OperationType),
            ["ok"] = false,
        }),
        HumanPromptRegistered h => (ProtocolEvents.HumanPromptCreated, new JsonObject
        {
            ["replyId"] = reply.ReplyId,
            ["promptId"] = h.PromptId.Value,
            ["title"] = "Approval needed",
            ["body"] = h.PromptText,
        }),
        HumanPromptAnswered h => (ProtocolEvents.HumanPromptResolved, new JsonObject
        {
            ["replyId"] = reply.ReplyId,
            ["promptId"] = h.PromptId.Value,
        }),
        _ => (null, null),
    };

    private static string ToolLabel(string operationType) => operationType switch
    {
        ResourceOperationTypes.LlmGenerate or ResourceOperationTypes.LlmStructuredGenerate => "Thinking",
        ResourceOperationTypes.ArtifactCreate or ResourceOperationTypes.ArtifactAppend => "Saving file",
        ResourceOperationTypes.MetadataCreate => "Recording",
        ResourceOperationTypes.MetadataQuery => "Looking up",
        ResourceOperationTypes.ShellExecute => "Running command",
        ResourceOperationTypes.HumanApprove or ResourceOperationTypes.HumanAnswer => "Awaiting approval",
        ResourceOperationTypes.ScheduleCreate => "Scheduling",
        _ => operationType,
    };
}
