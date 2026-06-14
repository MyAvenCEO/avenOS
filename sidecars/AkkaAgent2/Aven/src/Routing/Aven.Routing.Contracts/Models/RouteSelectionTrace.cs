namespace Aven.Routing.Contracts.Models;

public sealed record RouteSelectionTrace(
    string Provider,
    string Model,
    bool Used,
    bool FallbackToDeterministic,
    IReadOnlyList<RouteSelectionAttemptTrace> Attempts);
