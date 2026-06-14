using Akka.Actor;
using Aven.Akka.Hosting;

namespace Aven.Resources.Runtime.Modules;

public interface IAvenResourceModule
{
    string ResourceKind { get; }
    ActorAddress GatewayAddress { get; }
    string GatewayActorName { get; }
    bool RecoverOnStartup { get; }

    IActorRef StartGateway(ActorSystem system, LocalActorAddressRegistry resolver);
}