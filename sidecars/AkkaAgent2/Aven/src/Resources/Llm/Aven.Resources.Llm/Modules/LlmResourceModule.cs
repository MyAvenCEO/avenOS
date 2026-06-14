using Akka.Actor;
using Aven.Akka.Hosting;
using Aven.Resources.Llm;

namespace Aven.Resources.Llm.Modules;

public sealed class LlmResourceModule(
    IActorRef schemaRegistryActor,
    LlmExtractionPipeline extractionPipeline,
    IResourceOperationInboxStore inboxStore,
    CapabilityAdmissionClient capabilityAuthority,
    LlmModelCapabilities defaultModel) : IAvenResourceModule
{
    public string ResourceKind => ResourceKinds.Llm;
    public ActorAddress GatewayAddress => ResourceAddresses.Gateway(ResourceKind);
    public string GatewayActorName => "resource-llm-gateway";
    public bool RecoverOnStartup => true;

    public IActorRef StartGateway(ActorSystem system, LocalActorAddressRegistry resolver) =>
        system.ActorOf(
            Props.Create(() => new LlmGatewayActor(resolver, schemaRegistryActor, extractionPipeline, inboxStore, capabilityAuthority, defaultModel)),
            GatewayActorName);
}
