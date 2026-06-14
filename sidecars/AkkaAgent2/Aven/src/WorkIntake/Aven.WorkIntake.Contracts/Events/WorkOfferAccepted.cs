namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkOfferAccepted(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId RoleAgentId,
    WorkClaimId ClaimId,
    decimal Confidence,
    string AcceptedScope,
    string ExpectedCommandType,
    DateTimeOffset ExpiresAt,
    string Reason) : IAvenEvent;
