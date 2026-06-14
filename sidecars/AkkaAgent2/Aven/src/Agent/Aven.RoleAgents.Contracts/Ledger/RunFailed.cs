namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record RunFailed(
    RunId RunId,
    string Reason,
    DateTimeOffset FailedAt) : IAvenEvent;