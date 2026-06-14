namespace Aven.DurableDelivery.Contracts.Commands;

public sealed record DeliveryCancel(DeliveryId DeliveryId, string Reason);
