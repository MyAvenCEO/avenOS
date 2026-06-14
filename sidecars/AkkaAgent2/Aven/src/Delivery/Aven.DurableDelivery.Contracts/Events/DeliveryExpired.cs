namespace Aven.DurableDelivery.Contracts.Events;

public sealed record DeliveryExpired(
    DeliveryId DeliveryId,
    DateTimeOffset ExpiredAt,
    OperationError Error) : IAvenEvent;