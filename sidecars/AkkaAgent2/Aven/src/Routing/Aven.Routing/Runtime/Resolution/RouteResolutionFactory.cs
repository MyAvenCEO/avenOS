namespace Aven.Routing.Runtime.Resolution;

internal static class RouteResolutionFactory
{
    public static RouteNeedsClarification CreateLlmClarification(
        RouteInput input,
        IReadOnlyList<RouteAuditEntry> auditEntries,
        RouteSelectionTrace? llmTrace,
        ParsedRouteResolution rankedDecision)
    {
        var question = rankedDecision.ClarificationQuestion ?? "I need clarification before I can route this input safely.";
        var attempt = new RouteAttemptRecord(
            input.RoutingAttemptId,
            input,
            RouteAttemptStatus.ClarificationRequired,
            auditEntries,
            null,
            null,
            question)
        {
            LlmTrace = llmTrace,
            ClarificationCandidateRoleAgentIds = rankedDecision.CandidateRoleAgentIds.ToArray()
        };

        return new RouteNeedsClarification(attempt, question, rankedDecision.CandidateRoleAgentIds);
    }

    public static RouteCommitted CreateCommitted(
        RouteInput input,
        IReadOnlyList<RouteAuditEntry> auditEntries,
        RouteSelectionTrace? llmTrace,
        RoleAgentId roleAgentId,
        WorkClaimId claimId,
        WorkClaimCommitAccepted commitAccepted)
    {
        var attempt = new RouteAttemptRecord(
            input.RoutingAttemptId,
            input,
            RouteAttemptStatus.Routed,
            auditEntries,
            roleAgentId,
            claimId,
            null)
        {
            LlmTrace = llmTrace
        };

        return new RouteCommitted(attempt, roleAgentId, claimId, commitAccepted);
    }

    public static RouteRejected CreateCommitRejected(
        RouteInput input,
        IReadOnlyList<RouteAuditEntry> auditEntries,
        RouteSelectionTrace? llmTrace,
        WorkClaimCommitRejected rejectedCommit)
    {
        var attempt = new RouteAttemptRecord(
            input.RoutingAttemptId,
            input,
            RouteAttemptStatus.Rejected,
            auditEntries,
            null,
            null,
            rejectedCommit.Error.Message)
        {
            LlmTrace = llmTrace
        };

        return new RouteRejected(attempt, rejectedCommit.Error.Message);
    }

    public static RouteNeedsClarification CreateMultipleAcceptedClarification(
        RouteInput input,
        IReadOnlyList<RouteAuditEntry> auditEntries,
        RouteSelectionTrace? llmTrace,
        IReadOnlyList<(RoleAgentProfile Profile, WorkOfferAcceptedDecision Accepted)> accepted)
    {
        var question = $"Multiple agents accepted this input: {string.Join(", ", accepted.Select(static x => x.Profile.DisplayName))}. Which one should handle it?";
        var candidateRoleAgentIds = accepted.Select(static x => x.Profile.RoleAgentId).ToArray();
        var attempt = new RouteAttemptRecord(
            input.RoutingAttemptId,
            input,
            RouteAttemptStatus.ClarificationRequired,
            auditEntries,
            null,
            null,
            question)
        {
            LlmTrace = llmTrace,
            ClarificationCandidateRoleAgentIds = candidateRoleAgentIds
        };

        return new RouteNeedsClarification(attempt, question, candidateRoleAgentIds);
    }

    public static RouteNeedsClarification CreateFirstClarificationCandidate(
        RouteInput input,
        IReadOnlyList<RouteAuditEntry> auditEntries,
        RouteSelectionTrace? llmTrace,
        (RoleAgentProfile Profile, WorkOfferNeedsClarification Clarification) clarification)
    {
        var candidateRoleAgentIds = new[] { clarification.Profile.RoleAgentId };
        var attempt = new RouteAttemptRecord(
            input.RoutingAttemptId,
            input,
            RouteAttemptStatus.ClarificationRequired,
            auditEntries,
            null,
            null,
            clarification.Clarification.Question)
        {
            LlmTrace = llmTrace,
            ClarificationCandidateRoleAgentIds = candidateRoleAgentIds
        };

        return new RouteNeedsClarification(attempt, clarification.Clarification.Question, candidateRoleAgentIds);
    }

    public static RouteNeedsClarification CreateFallbackClarification(
        RouteInput input,
        IReadOnlyList<RouteAuditEntry> auditEntries,
        RouteSelectionTrace? llmTrace)
    {
        const string fallbackQuestion = "I could not determine which agent should handle this input. Should I route it elsewhere or create a new role agent?";
        var attempt = new RouteAttemptRecord(
            input.RoutingAttemptId,
            input,
            RouteAttemptStatus.ClarificationRequired,
            auditEntries,
            null,
            null,
            fallbackQuestion)
        {
            LlmTrace = llmTrace,
            ClarificationCandidateRoleAgentIds = Array.Empty<RoleAgentId>()
        };

        return new RouteNeedsClarification(attempt, fallbackQuestion, Array.Empty<RoleAgentId>());
    }

    public static RouteResolution CreatePersistedResolution(RouteAttemptRecord attempt, bool idempotentCommit)
        => attempt.Status switch
        {
            RouteAttemptStatus.Routed => new RouteCommitted(
                attempt,
                attempt.SelectedRoleAgentId ?? throw new InvalidOperationException("Routed attempt is missing selected agent id."),
                attempt.SelectedClaimId ?? throw new InvalidOperationException("Routed attempt is missing selected claim id."),
                new WorkClaimCommitAccepted(FindCommittedOfferId(attempt), attempt.SelectedClaimId ?? throw new InvalidOperationException("Routed attempt is missing selected claim id."), idempotentCommit)),
            RouteAttemptStatus.ClarificationRequired => new RouteNeedsClarification(
                attempt,
                attempt.ClarificationQuestion ?? "Clarification required.",
                ResolveClarificationCandidateRoleAgentIds(attempt)),
            RouteAttemptStatus.Rejected => new RouteRejected(
                attempt,
                attempt.ClarificationQuestion ?? "Routing rejected."),
            _ => throw new InvalidOperationException($"Unsupported routing attempt status '{attempt.Status}'.")
        };

    public static RouteResolution RebindToPersistedAttempt(RouteResolution resolution, RouteAttemptRecord persistedAttempt)
        => resolution switch
        {
            RouteCommitted committed => new RouteCommitted(persistedAttempt, committed.RoleAgentId, committed.ClaimId, committed.Commit),
            RouteNeedsClarification clarification => new RouteNeedsClarification(
                persistedAttempt,
                clarification.Question,
                persistedAttempt.ClarificationCandidateRoleAgentIds.Count > 0
                    ? persistedAttempt.ClarificationCandidateRoleAgentIds
                    : clarification.CandidateRoleAgentIds),
            RouteRejected rejected => new RouteRejected(persistedAttempt, rejected.Reason),
            _ => throw new InvalidOperationException($"Unsupported route resolution type '{resolution.GetType().Name}'.")
        };

    public static WorkOfferId FindCommittedOfferId(RouteAttemptRecord attempt)
        => attempt.AuditEntries
               .FirstOrDefault(entry =>
                   string.Equals(entry.DecisionKind, "accepted", StringComparison.OrdinalIgnoreCase)
                   && attempt.SelectedRoleAgentId is not null
                   && entry.RoleAgentId == attempt.SelectedRoleAgentId)
               ?.OfferId
           ?? attempt.AuditEntries
               .FirstOrDefault(entry => string.Equals(entry.DecisionKind, "accepted", StringComparison.OrdinalIgnoreCase))
               ?.OfferId
           ?? new WorkOfferId($"offer-{attempt.RoutingAttemptId.Value}");

    public static RoleAgentId[] ResolveClarificationCandidateRoleAgentIds(RouteAttemptRecord attempt)
    {
        if (attempt.ClarificationCandidateRoleAgentIds.Count > 0)
        {
            return attempt.ClarificationCandidateRoleAgentIds.Distinct().ToArray();
        }

        return attempt.AuditEntries
            .Where(entry =>
                string.Equals(entry.DecisionKind, "accepted", StringComparison.OrdinalIgnoreCase)
                || string.Equals(entry.DecisionKind, "needs_clarification", StringComparison.OrdinalIgnoreCase))
            .Select(static entry => entry.RoleAgentId)
            .Distinct()
            .ToArray();
    }
}
