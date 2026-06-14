namespace Aven.WorkIntake.Contracts.State;

public sealed record WorkOfferState(
    WorkOffer Offer,
    string PayloadHash,
    WorkIntakeLifecycleStatus Status,
    WorkOfferDecision Decision,
    WorkOfferAcceptedDecision? Accepted,
    WorkClaimCommitRecord? Commit,
    OperationError? TerminalError)
{
    public WorkOfferId OfferId => Offer.OfferId;
}
