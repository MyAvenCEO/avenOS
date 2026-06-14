namespace Aven.Routing.Contracts.Responses;

public sealed record RouteRejected(
    RouteAttemptRecord Attempt,
    string Reason)
    : RouteResolution(Attempt);
