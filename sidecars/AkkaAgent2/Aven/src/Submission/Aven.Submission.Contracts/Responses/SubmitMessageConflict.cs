namespace Aven.Submission.Contracts.Responses;

public sealed record SubmitMessageConflict(string IdempotencyKey, OperationError Error);
