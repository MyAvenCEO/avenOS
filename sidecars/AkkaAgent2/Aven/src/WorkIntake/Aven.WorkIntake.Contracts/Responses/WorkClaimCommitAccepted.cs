namespace Aven.WorkIntake.Contracts.Responses;

public sealed record WorkClaimCommitAccepted(WorkOfferId OfferId, WorkClaimId ClaimId, bool Idempotent);
