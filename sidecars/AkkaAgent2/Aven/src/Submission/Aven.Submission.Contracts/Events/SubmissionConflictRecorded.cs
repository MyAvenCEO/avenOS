namespace Aven.Submission.Contracts.Events;

public sealed record SubmissionConflictRecorded(
    string IdempotencyKey,
    string ExistingBodyHash,
    string IncomingBodyHash,
    OperationError Error,
    DateTimeOffset ConflictedAt) : IAvenEvent;
