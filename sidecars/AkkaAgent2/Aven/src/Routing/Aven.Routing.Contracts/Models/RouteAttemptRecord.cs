namespace Aven.Routing.Contracts.Models;

public sealed record RouteAttemptRecord(
    RoutingAttemptId RoutingAttemptId,
    RouteInput Input,
    RouteAttemptStatus Status,
    IReadOnlyList<RouteAuditEntry> AuditEntries,
    RoleAgentId? SelectedRoleAgentId,
    WorkClaimId? SelectedClaimId,
    string? ClarificationQuestion)
{
    public RouteSelectionTrace? LlmTrace { get; init; }
    public IReadOnlyList<RoleAgentId> ClarificationCandidateRoleAgentIds { get; init; } = Array.Empty<RoleAgentId>();
}
