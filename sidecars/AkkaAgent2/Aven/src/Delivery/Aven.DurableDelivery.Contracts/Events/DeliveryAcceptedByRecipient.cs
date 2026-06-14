namespace Aven.DurableDelivery.Contracts.Events;

public sealed record DeliveryAcceptedByRecipient(
    DeliveryId DeliveryId,
    DateTimeOffset AcceptedAt,
    string AcceptanceKind) : IAvenEvent;
