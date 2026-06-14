namespace Aven.WorkIntake.Runtime.Commit;

internal static class WorkClaimCommitPlanner
{
    internal abstract record WorkClaimCommitPlan
    {
        public sealed record Reject(WorkClaimCommitRejected Rejection) : WorkClaimCommitPlan;
        public sealed record Resume(WorkClaimCommitAccepted Reply) : WorkClaimCommitPlan;
        public sealed record Expire(WorkOfferExpired Event) : WorkClaimCommitPlan;
        public sealed record Start(WorkOfferState OfferState, WorkOfferAcceptedDecision Accepted, WorkClaimCommitRequested Event) : WorkClaimCommitPlan;
    }

    public static WorkClaimCommitPlan Plan(
        WorkIntakeState state,
        WorkClaimCommit commit,
        DateTimeOffset now,
        bool deliveryAvailable)
    {
        if (!state.Claims.TryGetValue(commit.ClaimId, out var offerId) || offerId != commit.OfferId)
        {
            return Reject(commit.OfferId, "claim_not_found", "Accepted claim was not found for commit.", false);
        }

        if (!state.Offers.TryGetValue(commit.OfferId, out var offerState) || offerState.Accepted is null)
        {
            return Reject(commit.OfferId, "claim_not_found", "Accepted claim was not found for commit.", false);
        }

        var accepted = offerState.Accepted;
        if (offerState.Status is WorkIntakeLifecycleStatus.Committed or WorkIntakeLifecycleStatus.Committing)
        {
            return new WorkClaimCommitPlan.Resume(new WorkClaimCommitAccepted(commit.OfferId, commit.ClaimId, true));
        }

        if (offerState.Status is WorkIntakeLifecycleStatus.Rejected or WorkIntakeLifecycleStatus.Expired or WorkIntakeLifecycleStatus.Released)
        {
            return new WorkClaimCommitPlan.Reject(
                new WorkClaimCommitRejected(
                    commit.OfferId,
                    offerState.TerminalError ?? new OperationError("claim_not_available", $"Claim is in terminal state {offerState.Status}.", false)));
        }

        var committedAt = commit.CommittedAt ?? now;
        if (committedAt > accepted.ExpiresAt)
        {
            return new WorkClaimCommitPlan.Expire(
                new WorkOfferExpired(
                    commit.OfferId,
                    commit.ClaimId,
                    committedAt,
                    new OperationError("claim_expired", "Accepted claim expired before commit.", false)));
        }

        if (!deliveryAvailable)
        {
            return Reject(commit.OfferId, "agent_recipient_unavailable", "No durable actor recipient was configured for the accepted claim commit.", true);
        }

        var claimId = commit.ClaimId;
        var deliveryId = new DeliveryId($"delivery-{claimId.Value}");
        var commandId = new CommandId($"cmd-{claimId.Value}");
        var messageId = new MessageId($"msg-{claimId.Value}");
        var startedAt = now;
        return new WorkClaimCommitPlan.Start(
            offerState,
            accepted,
            new WorkClaimCommitRequested(
                commit.OfferId,
                claimId,
                string.Empty,
                accepted.ExpectedCommandType,
                deliveryId,
                commandId,
                messageId,
                startedAt));
    }

    private static WorkClaimCommitPlan.Reject Reject(WorkOfferId offerId, string code, string message, bool retryable) =>
        new(new WorkClaimCommitRejected(offerId, new OperationError(code, message, retryable)));
}
