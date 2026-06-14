namespace Aven.DurableDelivery.Contracts.Protocol;

public sealed record DeliveryTerminalSignal(
    DeliveryId DeliveryId,
    DeliveryState State);
