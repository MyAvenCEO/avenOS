namespace Aven.ActorKernel.Addressing;

public sealed class UnknownActorAddressException(ActorAddress address)
    : InvalidOperationException($"No actor is registered for address '{address.Protocol}:{address.Value}'.")
{
    public ActorAddress Address { get; } = address;
}
