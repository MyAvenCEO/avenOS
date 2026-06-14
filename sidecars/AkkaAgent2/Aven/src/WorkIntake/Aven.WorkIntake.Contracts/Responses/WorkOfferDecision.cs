namespace Aven.WorkIntake.Contracts.Responses;

public abstract record WorkOfferDecision(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId RoleAgentId);