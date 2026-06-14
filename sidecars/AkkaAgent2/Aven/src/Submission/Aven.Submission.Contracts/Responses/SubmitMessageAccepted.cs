namespace Aven.Submission.Contracts.Responses;

public sealed record SubmitMessageAccepted(
    string IdempotencyKey,
    bool Idempotent,
    CorrelationId CorrelationId,
    RoutingAttemptId RoutingAttemptId,
    DeliveryState Delivery,
    RouteResolution Decision);
