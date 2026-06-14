using Akka.Actor;

namespace Aven.ActorKernel.Addressing;

public interface IActorAddressResolver
{
    bool TryResolve(ActorAddress address, out IActorRef? actorRef);
    IActorRef Resolve(ActorAddress address);
}
