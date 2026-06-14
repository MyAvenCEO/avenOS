namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record RunProgressed(
    RunId RunId,
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    string? RunStateJson,
    CorrelationId CorrelationId,
    DateTimeOffset RecordedAt) : IAvenEvent;