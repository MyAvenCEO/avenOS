namespace Aven.Submission.Contracts.Events;

public sealed record RoutingDeliveryAccepted(
    string IdempotencyKey,
    RoutingAttemptId RoutingAttemptId,
    DeliveryId DeliveryId,
    DateTimeOffset AcceptedAt,
    string AcceptanceKind) : IAvenEvent;
