using Akka.Persistence;
using Aven.Toolkit.Core.Serialization;

namespace Aven.ActorKernel;

public abstract class AvenPersistentActor : ReceivePersistentActor
{
    private static readonly CanonicalJsonSerializer CanonicalJsonSerializer = new();

    protected void PersistEvent<TEvent>(
        TEvent data,
        EventMetadata metadata,
        Action<TEvent> apply)
        where TEvent : IAvenEvent
    {
        var envelope = new AvenEventEnvelope<TEvent>(metadata, data);
        Persist(envelope, persisted =>
        {
            ApplyEvent(persisted);
            apply(persisted.Data);
        });
    }

    protected void RecoverEvent<TEvent>(Action<TEvent> apply)
        where TEvent : IAvenEvent
    {
        Recover<AvenEventEnvelope<TEvent>>(persisted =>
        {
            ApplyEvent(persisted);
            apply(persisted.Data);
        });
    }

    protected virtual void ApplyEvent<TEvent>(AvenEventEnvelope<TEvent> envelope)
        where TEvent : IAvenEvent
    {
        Context.System.EventStream.Publish(envelope);
    }

    protected EventMetadata MetadataFor<TEvent>(
        ActorAddress actorAddress,
        string actorKind,
        CorrelationId correlationId,
        object? payloadForHash = null,
        CommandId? commandId = null,
        DeliveryId? deliveryId = null,
        OperationKey? operationKey = null,
        MessageId? causationId = null,
        DateTimeOffset? occurredAt = null)
        where TEvent : IAvenEvent
    {
        var payloadHash = CanonicalJsonSerializer.Hash(payloadForHash ?? string.Empty);
        return new EventMetadata(
            $"evt-{Guid.NewGuid():N}",
            typeof(TEvent).Name,
            1,
            actorAddress,
            actorKind,
            commandId,
            deliveryId,
            operationKey,
            correlationId,
            causationId,
            payloadHash,
            occurredAt ?? DateTimeOffset.UtcNow);
    }

    protected static string Sanitize(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var index = 0;
        foreach (var ch in value)
        {
            buffer[index++] = char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-';
        }

        return new string(buffer[..index]);
    }

    protected CorrelationId ActorLocalCorrelationId() => new($"corr-{Sanitize(PersistenceId)}");
}