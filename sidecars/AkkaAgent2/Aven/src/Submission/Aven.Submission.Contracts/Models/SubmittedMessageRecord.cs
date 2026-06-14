namespace Aven.Submission.Contracts.Models;

public sealed record SubmittedMessageRecord(
    string IdempotencyKey,
    string BodyHash,
    SubmittedMessageStatus Status,
    DateTimeOffset RecordedAt,
    RoutingAttemptId? RoutingAttemptId,
    DeliveryState? Delivery,
    RouteResolution? Decision,
    OperationError? Error);
