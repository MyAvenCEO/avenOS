namespace Aven.WorkIntake.Contracts.Responses;

public sealed record WorkOfferRejectedDecision(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId RoleAgentId,
    string ReasonCode,
    string Reason,
    bool Retryable,
    IReadOnlyList<string> SuggestedAgentKinds,
    string? SuggestedClarifyingQuestion = null)
    : WorkOfferDecision(RoutingAttemptId, OfferId, RoleAgentId);
