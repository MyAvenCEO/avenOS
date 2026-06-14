namespace Aven.WorkIntake.Contracts.Responses;

public sealed record WorkOfferNeedsClarification(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId RoleAgentId,
    string Question)
    : WorkOfferDecision(RoutingAttemptId, OfferId, RoleAgentId);
