namespace Aven.Routing.Contracts.Responses;

public sealed record RouteCommitted(
    RouteAttemptRecord Attempt,
    RoleAgentId RoleAgentId,
    WorkClaimId ClaimId,
    WorkClaimCommitAccepted Commit)
    : RouteResolution(Attempt);
