namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record ActiveRunState(
    RunId RunId,
    WorkItemId WorkItemId,
    string Goal,
    DateTimeOffset StartedAt,
    string? RunStateJson,
    CorrelationId CorrelationId);