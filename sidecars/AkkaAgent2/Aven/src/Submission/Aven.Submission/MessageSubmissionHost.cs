using Akka.Actor;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Submission;

public static class MessageSubmissionHost
{
    private static readonly ActorAddress RoutingGatewayAddress = new("routing/role", "local");

    public static IActorRef Start(
        ActorSystem system,
        string persistenceId,
        IActorAddressRegistry resolver,
        RoleRoutingClient router,
        CanonicalJsonSerializer serializer,
        string actorName)
    {
        resolver.Register(RoutingGatewayAddress, router.ActorRef);
        return system.ActorOf(
            Props.Create(() => new MessageSubmissionActor(persistenceId, router, serializer, resolver)),
            actorName);
    }
}