namespace Aven.DurableDelivery.Contracts.Responses;

public sealed record DeliveryAccepted(
    DeliveryId DeliveryId,
    CommandId CommandId,
    ActorAddress Recipient,
    string AcceptanceKind);
