namespace Aven.DurableDelivery.Contracts.Events;

public sealed record DeliveryQuarantined(
    DeliveryId DeliveryId,
    OperationError Error) : IAvenEvent;
