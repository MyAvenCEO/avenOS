namespace Aven.DurableDelivery.Contracts.Events;

public sealed record DeliveryInitialized(
    DeliveryId DeliveryId,
    ActorAddress Owner,
    CommandId CommandId,
    MessageId MessageId,
    ActorAddress Sender,
    ActorAddress Recipient,
    ActorAddress ReplyTo,
    CorrelationId CorrelationId,
    string MessageType,
    int MessageVersion,
    PersistedCommandPayload Payload,
    CapabilityId? CapabilityId,
    MessageId? CausationId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt = null) : IAvenEvent;
