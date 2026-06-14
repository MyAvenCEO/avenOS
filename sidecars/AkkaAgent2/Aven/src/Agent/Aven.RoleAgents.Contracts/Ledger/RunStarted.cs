namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record RunStarted(
    RunId RunId,
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    string Goal,
    DateTimeOffset StartedAt) : IAvenEvent;