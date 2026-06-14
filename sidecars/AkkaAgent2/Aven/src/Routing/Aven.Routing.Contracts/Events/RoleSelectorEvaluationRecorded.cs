namespace Aven.Routing.Contracts.Events;

public sealed record RoleSelectorEvaluationRecorded(
    RoutingAttemptId RoutingAttemptId,
    string Provider,
    string Model,
    bool Used,
    bool FallbackToDeterministic,
    RouteSelectionAttemptSummary[] AttemptSummaries) : IAvenEvent;
