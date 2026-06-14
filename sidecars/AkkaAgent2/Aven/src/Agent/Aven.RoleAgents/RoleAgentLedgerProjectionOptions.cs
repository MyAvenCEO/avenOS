namespace Aven.RoleAgents;

public sealed record RoleAgentLedgerProjectionOptions(
    int MaxBufferedLiveEventsDuringBackfill = 10_000,
    int MaxPendingApplies = 10_000);
