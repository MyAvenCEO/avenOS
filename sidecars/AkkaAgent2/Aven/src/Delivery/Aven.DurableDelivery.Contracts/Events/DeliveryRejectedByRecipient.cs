namespace Aven.DurableDelivery.Contracts.Events;

public sealed record DeliveryRejectedByRecipient(
    DeliveryId DeliveryId,
    OperationError Error) : IAvenEvent;
