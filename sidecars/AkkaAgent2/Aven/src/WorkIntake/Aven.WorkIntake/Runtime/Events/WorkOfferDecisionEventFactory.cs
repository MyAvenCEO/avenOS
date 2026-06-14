using WorkOfferAcceptedEvent = Aven.WorkIntake.Contracts.Events.WorkOfferAccepted;
using WorkOfferRejectedEvent = Aven.WorkIntake.Contracts.Events.WorkOfferRejected;

namespace Aven.WorkIntake.Runtime.Events;

internal static class WorkOfferDecisionEventFactory
{
    public static object CreateDecisionEvent(WorkOfferDecision decision) => decision switch
    {
        WorkOfferAcceptedDecision accepted => new WorkOfferAcceptedEvent(
            accepted.RoutingAttemptId,
            accepted.OfferId,
            accepted.RoleAgentId,
            accepted.ClaimId,
            accepted.Confidence,
            accepted.AcceptedScope,
            accepted.ExpectedCommandType,
            accepted.ExpiresAt,
            accepted.Reason),
        WorkOfferRejectedDecision rejected => new WorkOfferRejectedEvent(
            rejected.RoutingAttemptId,
            rejected.OfferId,
            rejected.RoleAgentId,
            rejected.ReasonCode,
            rejected.Reason,
            rejected.Retryable,
            rejected.SuggestedAgentKinds.ToArray(),
            rejected.SuggestedClarifyingQuestion),
        WorkOfferNeedsClarification clarification => new WorkOfferClarificationRequested(
            clarification.RoutingAttemptId,
            clarification.OfferId,
            clarification.RoleAgentId,
            clarification.Question),
        _ => throw new InvalidOperationException($"Unsupported work-offer decision type '{decision.GetType().Name}'.")
    };
}
