namespace Aven.Contracts.Messaging;

public sealed record AvenEnvelope<TPayload>(
    CommandId CommandId,
    MessageId MessageId,
    ActorAddress Sender,
    ActorAddress Recipient,
    ActorAddress ReplyTo,
    CorrelationId CorrelationId,
    string MessageType,
    int MessageVersion,
    TPayload Payload,
    CapabilityId? CapabilityId,
    MessageId? CausationId,
    DateTimeOffset CreatedAt);
