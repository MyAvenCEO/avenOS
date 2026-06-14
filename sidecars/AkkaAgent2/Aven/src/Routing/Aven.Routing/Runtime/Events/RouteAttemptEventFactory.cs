using Aven.Routing.Runtime.Resolution;

namespace Aven.Routing.Runtime.Events;

internal static class RouteAttemptEventFactory
{
    public static IReadOnlyList<IAvenEvent> Create(RouteAttemptRecord attempt)
    {
        var events = new List<IAvenEvent>
        {
            new RouteAttemptStarted(
                attempt.RoutingAttemptId,
                attempt.Input.IncomingItemRef,
                attempt.Input.InputType,
                attempt.Input.AttachmentRefs.ToArray(),
                attempt.Input.ContentSummary,
                attempt.Input.ProposedIntent,
                attempt.Input.ProposedReason,
                attempt.Input.RequiredSchemas.ToArray(),
                attempt.Input.CorrelationId,
                attempt.Input.ReplyTo)
        };

        if (attempt.LlmTrace is not null)
        {
            events.Add(new RoleSelectorEvaluationRecorded(
                attempt.RoutingAttemptId,
                attempt.LlmTrace.Provider,
                attempt.LlmTrace.Model,
                attempt.LlmTrace.Used,
                attempt.LlmTrace.FallbackToDeterministic,
                attempt.LlmTrace.Attempts.Select(static trace => new RouteSelectionAttemptSummary(
                    trace.AttemptNumber,
                    trace.PromptSummary,
                    trace.ModelOutputJson,
                    trace.SchemaValidated,
                    trace.Decision,
                    trace.CandidateRoleAgentIds.ToArray(),
                    trace.ClarificationQuestion,
                    trace.ErrorCode,
                    trace.ErrorMessage)).ToArray()));
        }

        events.AddRange(attempt.AuditEntries.Select(entry => new RouteCandidateEvaluated(
            attempt.RoutingAttemptId,
            entry.RoleAgentId,
            entry.RoleName,
            entry.OfferId,
            entry.DecisionKind,
            entry.DecisionSummary)));

        switch (attempt.Status)
        {
            case RouteAttemptStatus.Routed:
                events.Add(new RoutingCommitted(
                    attempt.RoutingAttemptId,
                    attempt.SelectedRoleAgentId ?? throw new InvalidOperationException("Routed attempt is missing selected agent id."),
                    attempt.SelectedClaimId ?? throw new InvalidOperationException("Routed attempt is missing selected claim id.")));
                break;
            case RouteAttemptStatus.ClarificationRequired:
                events.Add(new RoutingClarificationRequested(
                    attempt.RoutingAttemptId,
                    attempt.ClarificationQuestion ?? "Clarification required.",
                    RouteResolutionFactory.ResolveClarificationCandidateRoleAgentIds(attempt)));
                break;
            case RouteAttemptStatus.Rejected:
                events.Add(new RoutingRejected(
                    attempt.RoutingAttemptId,
                    attempt.ClarificationQuestion ?? "Routing rejected."));
                break;
        }

        return events;
    }
}
