namespace Aven.Events.Interfaces;

public interface IAvenEventEnvelope
{
    EventMetadata Meta { get; }
    IAvenEvent Data { get; }
}
