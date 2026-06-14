using Akka.Actor;

namespace Aven.ActorKernel.Addressing;

public interface IActorAddressRegistry : IActorAddressResolver
{
    void Register(ActorAddress address, IActorRef actorRef);
}
