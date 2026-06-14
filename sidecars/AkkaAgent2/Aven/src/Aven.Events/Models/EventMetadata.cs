namespace Aven.Events.Models;

public sealed record EventMetadata(
    string EventId,
    string EventType,
    int EventVersion,
    ActorAddress ActorAddress,
    string ActorKind,
    CommandId? CommandId,
    DeliveryId? DeliveryId,
    OperationKey? OperationKey,
    CorrelationId CorrelationId,
    MessageId? CausationId,
    string PayloadHash,
    DateTimeOffset OccurredAt);
