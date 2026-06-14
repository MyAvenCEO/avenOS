namespace Aven.DurableDelivery.Contracts.Protocol;

public sealed record DeliveryAttemptOffer(
    DeliveryId DeliveryId,
    AvenEnvelope<string> Envelope,
    string PayloadHash);
