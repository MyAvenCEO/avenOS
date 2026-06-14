namespace Aven.WorkIntake.Contracts.Responses;

public sealed record WorkClaimCommitRejected(WorkOfferId OfferId, OperationError Error);
