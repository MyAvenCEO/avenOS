namespace Aven.Routing.Runtime.State;

internal static class RoutingAttemptReducer
{
    public static RoutingAttemptProjection Apply(RoutingAttemptProjection? current, RouteAttemptStarted started)
        => (current ?? RoutingAttemptProjection.Empty) with
        {
            Input = new RouteInput(
                started.RoutingAttemptId,
                started.IncomingItemRef,
                started.InputType,
                started.AttachmentRefs,
                started.ContentSummary,
                started.ProposedIntent,
                started.ProposedReason,
                started.RequiredSchemaRefs,
                started.CorrelationId,
                started.ReplyTo)
        };

    public static RoutingAttemptProjection Apply(RoutingAttemptProjection? current, RoleSelectorEvaluationRecorded recorded)
        => (current ?? RoutingAttemptProjection.Empty) with
        {
            LlmTrace = new RouteSelectionTrace(
                recorded.Provider,
                recorded.Model,
                recorded.Used,
                recorded.FallbackToDeterministic,
                recorded.AttemptSummaries.Select(static attempt => new RouteSelectionAttemptTrace(
                    attempt.AttemptNumber,
                    attempt.PromptSummary,
                    attempt.ModelOutputJson,
                    attempt.SchemaValidated,
                    attempt.Decision,
                    attempt.CandidateRoleAgentIds,
                    attempt.ClarificationQuestion,
                    attempt.ErrorCode,
                    attempt.ErrorMessage)).ToArray())
        };

    public static RoutingAttemptProjection Apply(RoutingAttemptProjection? current, RouteCandidateEvaluated evaluated)
    {
        var projection = current ?? RoutingAttemptProjection.Empty;
        return projection with
        {
            AuditEntries = projection.AuditEntries
                .Concat([new RouteAuditEntry(evaluated.RoleAgentId, evaluated.RoleName, evaluated.OfferId, evaluated.DecisionKind, evaluated.DecisionSummary)])
                .ToArray()
        };
    }

    public static RoutingAttemptProjection Apply(RoutingAttemptProjection? current, RoutingCommitted committed)
        => (current ?? RoutingAttemptProjection.Empty) with
        {
            Status = RouteAttemptStatus.Routed,
            SelectedRoleAgentId = committed.SelectedRoleAgentId,
            SelectedClaimId = committed.SelectedClaimId,
            ClarificationQuestion = null,
            ClarificationCandidateRoleAgentIds = Array.Empty<RoleAgentId>()
        };

    public static RoutingAttemptProjection Apply(RoutingAttemptProjection? current, RoutingClarificationRequested requested)
        => (current ?? RoutingAttemptProjection.Empty) with
        {
            Status = RouteAttemptStatus.ClarificationRequired,
            SelectedRoleAgentId = null,
            SelectedClaimId = null,
            ClarificationQuestion = requested.Question,
            ClarificationCandidateRoleAgentIds = requested.CandidateRoleAgentIds
        };

    public static RoutingAttemptProjection Apply(RoutingAttemptProjection? current, RoutingRejected rejected)
        => (current ?? RoutingAttemptProjection.Empty) with
        {
            Status = RouteAttemptStatus.Rejected,
            SelectedRoleAgentId = null,
            SelectedClaimId = null,
            ClarificationQuestion = rejected.Reason,
            ClarificationCandidateRoleAgentIds = Array.Empty<RoleAgentId>()
        };
}
