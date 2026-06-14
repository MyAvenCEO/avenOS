namespace Aven.Routing.Models;

public sealed record LlmRoutingEvaluation(
    ParsedRouteResolution? Decision,
    RouteSelectionTrace Trace,
    bool ProviderUnavailable);
