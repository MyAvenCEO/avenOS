namespace Aven.WorkIntake.Contracts.Responses;

public sealed record WorkOfferAcceptedDecision(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId RoleAgentId,
    WorkClaimId ClaimId,
    decimal Confidence,
    string AcceptedScope,
    string ExpectedCommandType,
    DateTimeOffset ExpiresAt,
    string Reason)
    : WorkOfferDecision(RoutingAttemptId, OfferId, RoleAgentId);
