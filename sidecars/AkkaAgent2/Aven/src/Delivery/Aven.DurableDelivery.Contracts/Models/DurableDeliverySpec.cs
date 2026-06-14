namespace Aven.DurableDelivery.Contracts.Models;

public sealed record DurableDeliverySpec(
    DeliveryId DeliveryId,
    ActorAddress Owner,
    AvenEnvelope<string> Envelope,
    DeliveryPolicy Policy,
    ActorAddress? TerminalNotifyTo = null);
