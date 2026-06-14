namespace Aven.Routing.Contracts.Events;

public sealed record RoutingCommitted(
    RoutingAttemptId RoutingAttemptId,
    RoleAgentId SelectedRoleAgentId,
    WorkClaimId SelectedClaimId) : IAvenEvent;
