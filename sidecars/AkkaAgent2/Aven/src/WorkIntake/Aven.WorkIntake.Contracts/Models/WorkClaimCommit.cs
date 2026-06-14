namespace Aven.WorkIntake.Contracts.Models;

public sealed record WorkClaimCommit(WorkOfferId OfferId, WorkClaimId ClaimId, DateTimeOffset? CommittedAt = null);
