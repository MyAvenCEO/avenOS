namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record RunBlocked(
    RunId RunId,
    string Reason,
    DateTimeOffset BlockedAt) : IAvenEvent;