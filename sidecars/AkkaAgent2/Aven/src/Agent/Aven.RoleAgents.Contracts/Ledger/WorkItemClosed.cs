namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record WorkItemClosed(
    WorkItemId WorkItemId,
    string Outcome,
    DateTimeOffset ClosedAt) : IAvenEvent;