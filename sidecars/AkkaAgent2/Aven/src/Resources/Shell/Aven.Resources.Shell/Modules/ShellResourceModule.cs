
using Aven.Akka.Hosting;

namespace Aven.Resources.Shell.Modules;

public sealed class ShellResourceModule(
    IResourceOperationInboxStore inboxStore,
    CapabilityAdmissionClient capabilityAuthority,
    ShellGatewayOptions options) : IAvenResourceModule
{
    public string ResourceKind => ResourceKinds.Shell;
    public ActorAddress GatewayAddress => ResourceAddresses.Gateway(ResourceKind);
    public string GatewayActorName => "resource-shell-gateway";
    public bool RecoverOnStartup => true;

    public IActorRef StartGateway(ActorSystem system, LocalActorAddressRegistry resolver) =>
        system.ActorOf(
            Props.Create(() => new ShellGatewayActor(resolver, inboxStore, options, capabilityAuthority)),
            GatewayActorName);
}
