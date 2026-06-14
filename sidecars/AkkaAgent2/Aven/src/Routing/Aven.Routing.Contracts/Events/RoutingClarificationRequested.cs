namespace Aven.Routing.Contracts.Events;

public sealed record RoutingClarificationRequested(
    RoutingAttemptId RoutingAttemptId,
    string Question,
    RoleAgentId[] CandidateRoleAgentIds) : IAvenEvent;
