namespace Aven.Submission.Contracts.Events;

public sealed record RoutingDeliveryRejected(
    string IdempotencyKey,
    RoutingAttemptId RoutingAttemptId,
    DeliveryId DeliveryId,
    OperationError Error) : IAvenEvent;
