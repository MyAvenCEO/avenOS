using Akka.Actor;

namespace Aven.Api.Models;

internal sealed record AgentRegistration(
    RoleAgentId RoleAgentId,
    RoleAgentProfile Profile,
    IActorRef RoleAgentActor,
    ActorAddress GatewayAddress,
    WorkIntakeClient Intake);
