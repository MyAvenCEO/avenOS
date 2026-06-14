using Akka.Actor;

namespace Aven.Routing.Clients;

public sealed class RoleRoutingClient
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);
    private readonly IActorRef _routerActor;

    public RoleRoutingClient(IActorRef routerActor)
    {
        _routerActor = routerActor;
    }

    public IActorRef ActorRef => _routerActor;

    public RouteResolution Route(RouteInput input) =>
        _routerActor.Ask<RouteResolution>(new RouteCommand(input), DefaultTimeout).GetAwaiter().GetResult();

    public RouteInspection Inspect() =>
        _routerActor.Ask<RouteInspection>(new InspectRouteAttempts(), DefaultTimeout).GetAwaiter().GetResult();

    public RouteAttemptRecord? GetAttempt(RoutingAttemptId id) =>
        _routerActor.Ask<RouteAttemptRecord?>(new GetRouteAttemptCommand(id), DefaultTimeout).GetAwaiter().GetResult();

    public RouteResolution? GetResolution(RoutingAttemptId id) =>
        _routerActor.Ask<RouteResolution?>(new GetRouteResolutionCommand(id), DefaultTimeout).GetAwaiter().GetResult();
}