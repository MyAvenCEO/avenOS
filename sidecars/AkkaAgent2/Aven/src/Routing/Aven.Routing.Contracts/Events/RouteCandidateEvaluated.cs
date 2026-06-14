namespace Aven.Routing.Contracts.Events;

public sealed record RouteCandidateEvaluated(
    RoutingAttemptId RoutingAttemptId,
    RoleAgentId RoleAgentId,
    string RoleName,
    WorkOfferId OfferId,
    string DecisionKind,
    string DecisionSummary) : IAvenEvent;
