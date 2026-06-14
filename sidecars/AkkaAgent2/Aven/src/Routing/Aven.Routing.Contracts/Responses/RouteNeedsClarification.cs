namespace Aven.Routing.Contracts.Responses;

public sealed record RouteNeedsClarification(
    RouteAttemptRecord Attempt,
    string Question,
    IReadOnlyList<RoleAgentId> CandidateRoleAgentIds)
    : RouteResolution(Attempt);
