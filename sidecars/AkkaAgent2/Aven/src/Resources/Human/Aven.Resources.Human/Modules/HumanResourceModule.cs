using Akka.Actor;
using Aven.Akka.Hosting;

namespace Aven.Resources.Human.Modules;

public sealed class HumanResourceModule(
    Func<HumanPromptRegistration, IActorRef> promptFactory,
    IActorRef humanPromptRegistryActor,
    IResourceOperationInboxStore inboxStore) : IAvenResourceModule
{
    public string ResourceKind => ResourceKinds.Human;
    public ActorAddress GatewayAddress => ResourceAddresses.Gateway(ResourceKind);
    public string GatewayActorName => "resource-human-gateway";
    public bool RecoverOnStartup => true;

    public IActorRef StartGateway(ActorSystem system, LocalActorAddressRegistry resolver) =>
        system.ActorOf(
            Props.Create(() => new HumanGatewayActor(promptFactory, humanPromptRegistryActor, inboxStore, resolver)),
            GatewayActorName);
}