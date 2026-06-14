namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkOfferClarificationRequested(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId RoleAgentId,
    string Question) : IAvenEvent;
