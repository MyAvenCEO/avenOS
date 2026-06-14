using Akka.Actor;
using Aven.Akka.Hosting;

namespace Aven.Resources.Metadata.Modules;

public sealed class MetadataResourceModule(
    IActorRef metadataActor,
    IActorRef schemaRegistryActor,
    IResourceOperationInboxStore inboxStore,
    CapabilityAdmissionClient capabilityAuthority) : IAvenResourceModule
{
    public string ResourceKind => ResourceKinds.Metadata;
    public ActorAddress GatewayAddress => ResourceAddresses.Gateway(ResourceKind);
    public string GatewayActorName => "resource-metadata-gateway";
    public bool RecoverOnStartup => true;

    public IActorRef StartGateway(ActorSystem system, LocalActorAddressRegistry resolver) =>
        system.ActorOf(
            Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, inboxStore, capabilityAuthority, schemaRegistryActor)),
            GatewayActorName);
}
