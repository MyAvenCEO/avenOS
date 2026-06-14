using Akka.Actor;

namespace Aven.WorkIntake.Hosting;

public static class WorkIntakeHost
{
    public static IActorRef Start(
        ActorSystem system,
        string persistenceId,
        RoleAgentId agentId,
        Func<RoleAgentState> agentStateProvider,
        Func<WorkOffer, RoleAgentState, WorkOfferDecision>? decisionFactory = null,
        IActorAddressResolver? resolver = null,
        ActorAddress? agentAddress = null,
        string? actorName = null)
        => system.ActorOf(
            Props.Create(() => new WorkOfferActor(persistenceId, agentId, agentStateProvider, decisionFactory, resolver, agentAddress)),
            actorName ?? persistenceId.Replace('/', '-'));
}
