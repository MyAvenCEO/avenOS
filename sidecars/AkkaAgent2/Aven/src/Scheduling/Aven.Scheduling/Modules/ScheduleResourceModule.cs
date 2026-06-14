using Akka.Actor;
using Aven.Akka.Hosting;

namespace Aven.Scheduling.Modules;

public sealed class ScheduleResourceModule(
    Func<object, IActorRef> scheduleFactory,
    IResourceOperationInboxStore inboxStore,
    CapabilityAdmissionClient capabilityAuthority) : IAvenResourceModule
{
    public string ResourceKind => ResourceKinds.Schedule;
    public ActorAddress GatewayAddress => ResourceAddresses.Gateway(ResourceKind);
    public string GatewayActorName => "resource-schedule-gateway";
    public bool RecoverOnStartup => true;

    public IActorRef StartGateway(ActorSystem system, LocalActorAddressRegistry resolver) =>
        system.ActorOf(
            Props.Create(() => new ScheduleGatewayActor(scheduleFactory, resolver, inboxStore, capabilityAuthority)),
            GatewayActorName);
}