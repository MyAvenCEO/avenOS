using Akka.Actor;

namespace Aven.Capabilities.Clients;

public static class CapabilityAdmissionHost
{
    public static IActorRef Start(ActorSystem system, string persistenceId, string actorName)
        => system.ActorOf(Props.Create(() => new CapabilityGrantRegistryActor(persistenceId)), actorName);
}