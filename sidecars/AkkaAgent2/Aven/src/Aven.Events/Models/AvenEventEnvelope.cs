namespace Aven.Events.Models;

public sealed record AvenEventEnvelope<TEvent>(
    EventMetadata Meta,
    TEvent Data)
    : IAvenEventEnvelope
    where TEvent : IAvenEvent
{
    IAvenEvent IAvenEventEnvelope.Data => Data;
}
