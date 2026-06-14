namespace Aven.DurableDelivery.Contracts.Events;

public sealed record DeliveryCancelled(
    DeliveryId DeliveryId,
    string Reason) : IAvenEvent;
