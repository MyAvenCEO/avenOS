namespace Aven.RoleAgents.Contracts.State;

public sealed record RoleAgentState(
    RoleAgentId RoleAgentId,
    RoleAgentStatus Status,
    RoleDescriptor RoleProfile,
    string Objective,
    string? RoleMemoryJson,
    IReadOnlyDictionary<WorkItemId, OpenWorkItemState> OpenWorkItems,
    IReadOnlyDictionary<WorkItemId, ActiveRunState> ActiveRuns,
    IReadOnlyDictionary<OperationId, PendingOperationState> PendingOperations,
    string? LastRunSummary)
{
    public static RoleAgentState Create(RoleAgentId agentId, RoleDescriptor roleProfile, string objective) =>
        new(
            agentId,
            RoleAgentStatus.Created,
            roleProfile,
            objective,
            null,
            new Dictionary<WorkItemId, OpenWorkItemState>(),
            new Dictionary<WorkItemId, ActiveRunState>(),
            new Dictionary<OperationId, PendingOperationState>(),
            null);
}
