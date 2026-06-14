using System.Text.Json;
using System.Text.Json.Nodes;
using Aven.Resources.Human.Contracts.Responses;
using Aven.Routing.Contracts.Responses;
using Aven.Submission.Contracts.Responses;

namespace Aven.Sidecar;

/// <summary>
/// Normalizes the <c>object</c> union returned by <c>RuntimeCompositionRoot.SubmitMessage</c>
/// into a single structured result node carrying a <c>status</c> discriminator
/// (accepted | clarification | rejected | conflict). The protocol call itself succeeds;
/// the domain outcome lives in the result so the UI can branch on it (milestone plan
/// M2 acceptance + M6 step 3).
/// </summary>
public static class SubmitResultMapper
{
    public static JsonNode ToResultNode(object response, JsonSerializerOptions options) => response switch
    {
        SubmitMessageAccepted accepted => Accepted(accepted, options),
        SubmitMessageNeedsClarification clarification => WithStatus(clarification, "clarification", options),
        SubmitMessageConflict conflict => WithStatus(conflict, "conflict", options),
        SubmitMessageRejected rejected => WithStatus(rejected, "rejected", options),
        _ => WithStatus(response, "unknown", options),
    };

    private static JsonObject Accepted(SubmitMessageAccepted accepted, JsonSerializerOptions options)
    {
        var node = WithStatus(accepted, "accepted", options);
        // Surface the routed agent id as a plain string so the frontend can poll messages.result
        // without depending on how the value-object Decision serializes.
        var agentId = ResolveAgentId(accepted);
        if (agentId is not null)
        {
            node["agentId"] = agentId;
        }

        return node;
    }

    private static string? ResolveAgentId(SubmitMessageAccepted accepted)
    {
        if (accepted.Decision is RouteCommitted committed)
        {
            return committed.RoleAgentId.Value;
        }

        return accepted.Decision.Attempt.SelectedRoleAgentId is { } selected ? selected.Value : null;
    }

    internal static JsonObject WithStatus(object value, string status, JsonSerializerOptions options)
    {
        var node = JsonSerializer.SerializeToNode(value, value.GetType(), options) as JsonObject ?? new JsonObject();
        node["status"] = status;
        return node;
    }
}

/// <summary>
/// Normalizes the human-prompt answer/cancel <c>object</c> unions into a structured
/// result node with a <c>status</c> discriminator.
/// </summary>
public static class HumanPromptResultMapper
{
    public static JsonNode ToResultNode(object reply, JsonSerializerOptions options) => reply switch
    {
        HumanPromptAnswerAccepted accepted => SubmitResultMapper.WithStatus(accepted, "accepted", options),
        HumanPromptAnswerConflict conflict => SubmitResultMapper.WithStatus(conflict, "conflict", options),
        HumanPromptAnswerRejected rejected => SubmitResultMapper.WithStatus(rejected, "rejected", options),
        HumanPromptOperationReplyUnavailable unavailable => SubmitResultMapper.WithStatus(unavailable, "unavailable", options),
        HumanPromptCancellationAccepted cancelled => SubmitResultMapper.WithStatus(cancelled, "cancelled", options),
        HumanPromptCancellationRejected rejected => SubmitResultMapper.WithStatus(rejected, "rejected", options),
        _ => SubmitResultMapper.WithStatus(reply, "unknown", options),
    };
}
