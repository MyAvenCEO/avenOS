namespace Aven.Submission.Contracts.Responses;

public sealed record SubmitMessageRejected(string IdempotencyKey, OperationError Error);
