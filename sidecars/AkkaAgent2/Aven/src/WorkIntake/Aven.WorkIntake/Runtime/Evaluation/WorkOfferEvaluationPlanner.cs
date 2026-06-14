namespace Aven.WorkIntake.Runtime.Evaluation;

internal static class WorkOfferEvaluationPlanner
{
    internal abstract record WorkOfferEvaluationPlan
    {
        public sealed record New(string PayloadHash) : WorkOfferEvaluationPlan;
        public sealed record Existing(WorkOfferDecision Decision) : WorkOfferEvaluationPlan;
        public sealed record Conflict(WorkClaimCommitRejected Rejection) : WorkOfferEvaluationPlan;
    }

    public static WorkOfferEvaluationPlan Plan(WorkIntakeState state, WorkOffer offer)
    {
        if (!state.Offers.TryGetValue(offer.OfferId, out var existing))
        {
            return new WorkOfferEvaluationPlan.New(WorkOfferHasher.ComputeHash(offer));
        }

        var payloadHash = WorkOfferHasher.ComputeHash(offer);
        if (!StringComparer.Ordinal.Equals(existing.PayloadHash, payloadHash))
        {
            return new WorkOfferEvaluationPlan.Conflict(
                new WorkClaimCommitRejected(
                    offer.OfferId,
                    new OperationError("intake_offer_conflict", "Offer payload conflict for same offer id.", false)));
        }

        return new WorkOfferEvaluationPlan.Existing(existing.Decision);
    }
}
