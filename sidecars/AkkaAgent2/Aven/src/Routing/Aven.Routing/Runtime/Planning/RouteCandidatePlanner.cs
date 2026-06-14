using Aven.WorkIntake.Contracts.Support;

namespace Aven.Routing.Runtime.Planning;

internal static class RouteCandidatePlanner
{
    public static IReadOnlyList<RoleAgentProfile> SelectProfilesForEvaluation(
        IReadOnlyList<RoleAgentProfile> profiles,
        LlmRoutingEvaluation? evaluation,
        bool llmRoutingEnabled)
    {
        if (!llmRoutingEnabled || evaluation is null)
        {
            return profiles;
        }

        if (evaluation.ProviderUnavailable && evaluation.Trace.FallbackToDeterministic)
        {
            return profiles;
        }

        if (evaluation.Decision?.CandidateRoleAgentIds is not { Count: > 0 })
        {
            return Array.Empty<RoleAgentProfile>();
        }

        var byId = profiles.ToDictionary(static x => x.RoleAgentId);
        return evaluation.Decision.CandidateRoleAgentIds
            .Distinct()
            .Where(byId.ContainsKey)
            .Take(3)
            .Select(id => byId[id])
            .ToArray();
    }

    public static WorkOffer CreateOffer(RouteInput input, RoleAgentProfile profile)
    {
        var offerId = new WorkOfferId($"{input.RoutingAttemptId.Value}-{profile.RoleAgentId.Value}");
        var normalizedInputType = InputTypeNormalizer.NormalizeOrInfer(input.InputType, input.IncomingItemRef);
        return new WorkOffer(
            input.RoutingAttemptId,
            offerId,
            profile.RoleAgentId,
            input.IncomingItemRef,
            normalizedInputType,
            input.AttachmentRefs,
            input.ContentSummary,
            input.ProposedIntent,
            input.ProposedReason,
            input.RequiredSchemas,
            input.CorrelationId,
            input.ReplyTo);
    }

    public static RouteAuditEntry CreateAuditEntry(RoleAgentProfile profile, WorkOfferId offerId, object decision) =>
        new(profile.RoleAgentId, profile.RoleName, offerId, DescribeDecisionKind(decision), DescribeDecisionSummary(decision));

    public static string DescribeDecisionKind(object decision) => decision switch
    {
        WorkOfferAcceptedDecision => "accepted",
        WorkOfferRejectedDecision => "rejected",
        WorkOfferNeedsClarification => "needs_clarification",
        WorkClaimCommitRejected => "conflict",
        _ => decision.GetType().Name
    };

    public static string DescribeDecisionSummary(object decision) => decision switch
    {
        WorkOfferAcceptedDecision accepted => accepted.Reason,
        WorkOfferRejectedDecision rejected => rejected.Reason,
        WorkOfferNeedsClarification clarification => clarification.Question,
        WorkClaimCommitRejected conflict => conflict.Error.Message,
        _ => decision.ToString() ?? decision.GetType().Name
    };
}
