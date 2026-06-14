namespace Aven.Submission.Contracts.Events;

public sealed record SubmissionRejected(
    string IdempotencyKey,
    string BodyHash,
    RoutingAttemptId? RoutingAttemptId,
    OperationError Error,
    DateTimeOffset RejectedAt) : IAvenEvent;
