namespace Aven.WorkIntake.Runtime.Evaluation;

internal static class WorkOfferDefaultDecisionPlanner
{
    public static WorkOfferDecision Decide(
        RoleAgentId agentId,
        RoleRegistration role,
        WorkOffer offer,
        DateTimeOffset now)
    {
        var offerMatchesRole = RoleBehaviorSupport.OfferMatchesRole(role, offer.ProposedIntent, offer.ContentSummary, offer.RequiredSchemas);
        var matchedSchema = role.Inputs.FirstOrDefault(input => input.RequiredSchemas.Count == 0 || input.RequiredSchemas.Intersect(offer.RequiredSchemas).Any());
        var matchedCommand = matchedSchema?.CommandType ?? (offerMatchesRole ? role.Inputs.FirstOrDefault()?.CommandType : null);
        if (offerMatchesRole && !string.IsNullOrWhiteSpace(matchedCommand))
        {
            return new WorkOfferAcceptedDecision(
                offer.RoutingAttemptId,
                offer.OfferId,
                agentId,
                new WorkClaimId($"claim-{offer.OfferId.Value}"),
                0.90m,
                role.Profile.ResponsibilityScope,
                matchedCommand!,
                now.AddMinutes(10),
                $"Matches {role.Profile.DisplayName} scope.");
        }

        if (offer.ContentSummary.Contains("maybe", StringComparison.OrdinalIgnoreCase))
        {
            return new WorkOfferNeedsClarification(offer.RoutingAttemptId, offer.OfferId, agentId, $"Can you clarify whether this belongs to {role.Profile.DisplayName}?");
        }

        return new WorkOfferRejectedDecision(offer.RoutingAttemptId, offer.OfferId, agentId, "out_of_scope", "Offer is outside the agent responsibility scope.", false, Array.Empty<string>());
    }
}
