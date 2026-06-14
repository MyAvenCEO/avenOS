namespace Aven.Routing.Contracts.Events;

public sealed record RoutingRejected(
    RoutingAttemptId RoutingAttemptId,
    string Reason) : IAvenEvent;
