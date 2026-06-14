namespace Aven.RoleAgents;

public sealed record RoleAgentLedgerProjectionHealth(
    bool Idle,
    bool BackfillInProgress,
    bool ApplyInProgress,
    int BufferedLiveEvents,
    int PendingApplies);
