using Akka.Actor;

namespace Aven.RoleAgents.Registry;

public static class RoleAgentRegistryHost
{
    public static IActorRef Start(ActorSystem system, string persistenceId, string actorName)
        => system.ActorOf(Props.Create(() => new RoleAgentRegistryActor(persistenceId)), actorName);
}