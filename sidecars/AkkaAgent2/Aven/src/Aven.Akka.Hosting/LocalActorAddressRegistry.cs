using Akka.Actor;

namespace Aven.Akka.Hosting;

public sealed class LocalActorAddressRegistry : IActorAddressRegistry
{
    private readonly Dictionary<ActorAddress, IActorRef> _actors = new();
    private readonly object _sync = new();

    public void Register(ActorAddress address, IActorRef actorRef)
    {
        ArgumentNullException.ThrowIfNull(actorRef);

        lock (_sync)
        {
            _actors[address] = actorRef;
        }
    }

    public bool TryResolve(ActorAddress address, out IActorRef? actorRef)
    {
        lock (_sync)
        {
            return _actors.TryGetValue(address, out actorRef);
        }
    }

    public IActorRef Resolve(ActorAddress address)
    {
        if (TryResolve(address, out var actorRef) && actorRef is not null)
        {
            return actorRef;
        }

        throw new UnknownActorAddressException(address);
    }
}