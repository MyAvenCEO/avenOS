namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkOfferRejected(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId RoleAgentId,
    string ReasonCode,
    string Reason,
    bool Retryable,
    string[] SuggestedAgentKinds,
    string? SuggestedClarifyingQuestion) : IAvenEvent;
