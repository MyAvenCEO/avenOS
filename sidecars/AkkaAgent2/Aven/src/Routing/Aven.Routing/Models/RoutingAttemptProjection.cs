namespace Aven.Routing.Models;

internal sealed record RoutingAttemptProjection(
    RouteInput? Input,
    IReadOnlyList<RouteAuditEntry> AuditEntries,
    RouteSelectionTrace? LlmTrace,
    RouteAttemptStatus Status,
    RoleAgentId? SelectedRoleAgentId,
    WorkClaimId? SelectedClaimId,
    string? ClarificationQuestion,
    IReadOnlyList<RoleAgentId> ClarificationCandidateRoleAgentIds)
{
    public static RoutingAttemptProjection Empty { get; } = new(
        null,
        Array.Empty<RouteAuditEntry>(),
        null,
        RouteAttemptStatus.ClarificationRequired,
        null,
        null,
        null,
        Array.Empty<RoleAgentId>());

    public RouteAttemptRecord ToRecord(RoutingAttemptId routingAttemptId)
    {
        var input = Input ?? throw new InvalidOperationException($"Routing attempt '{routingAttemptId.Value}' is missing start event.");
        return new RouteAttemptRecord(
            routingAttemptId,
            input,
            Status,
            AuditEntries,
            SelectedRoleAgentId,
            SelectedClaimId,
            ClarificationQuestion)
        {
            LlmTrace = LlmTrace,
            ClarificationCandidateRoleAgentIds = ClarificationCandidateRoleAgentIds
        };
    }
}

