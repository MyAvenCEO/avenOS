namespace Aven.Submission.Contracts.Events;

public sealed record RouteResolutionRecorded(
    string IdempotencyKey,
    RoutingAttemptId RoutingAttemptId,
    string DecisionKind,
    RoleAgentId? SelectedRoleAgentId,
    WorkClaimId? SelectedClaimId,
    string? ClarificationQuestion,
    RoleAgentId[] CandidateRoleAgentIds,
    string? Reason) : IAvenEvent;
