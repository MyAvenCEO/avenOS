namespace Aven.DurableDelivery.Contracts.Events;

public sealed record DeliveryAttemptStarted(
    DeliveryId DeliveryId,
    int AttemptNumber,
    DateTimeOffset AttemptedAt,
    DateTimeOffset? NextAttemptAt,
    DeliveryAttemptResult Result) : IAvenEvent;
