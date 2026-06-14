namespace Aven.Routing.Contracts.Responses;

public sealed record RouteInspection(IReadOnlyDictionary<RoutingAttemptId, RouteAttemptRecord> Attempts);
