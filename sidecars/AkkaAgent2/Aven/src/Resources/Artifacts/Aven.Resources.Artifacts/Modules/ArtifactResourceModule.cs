using Akka.Actor;
using Aven.Akka.Hosting;

namespace Aven.Resources.Artifacts.Modules;

public sealed class ArtifactResourceModule(
    IArtifactStore artifactStore,
    IArtifactBlobStore blobStore,
    IResourceOperationInboxStore inboxStore,
    CapabilityAdmissionClient capabilityAuthority) : IAvenResourceModule
{
    public string ResourceKind => ResourceKinds.Artifact;
    public ActorAddress GatewayAddress => ResourceAddresses.Gateway(ResourceKind);
    public string GatewayActorName => "resource-artifact-gateway";
    public bool RecoverOnStartup => true;

    public IActorRef StartGateway(ActorSystem system, LocalActorAddressRegistry resolver) =>
        system.ActorOf(
            Props.Create(() => new ArtifactGatewayActor(artifactStore, resolver, blobStore, inboxStore, capabilityAuthority)),
            GatewayActorName);
}