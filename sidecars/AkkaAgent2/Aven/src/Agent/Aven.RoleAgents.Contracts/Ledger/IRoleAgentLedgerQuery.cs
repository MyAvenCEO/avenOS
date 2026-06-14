namespace Aven.RoleAgents.Contracts.Ledger;

public interface IRoleAgentLedgerQuery
{
    Task<IReadOnlyList<WorkItemSnapshot>> ListWorkItemsAsync(
        RoleAgentId roleAgentId,
        WorkItemStatus? status,
        int? limit,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<RunSnapshot>> ListRunsAsync(
        RoleAgentId roleAgentId,
        WorkItemId? workItemId,
        RunStatus? status,
        int? limit,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<OperationSnapshot>> ListOperationsAsync(
        RoleAgentId roleAgentId,
        RunId? runId,
        OperationStatus? status,
        int? limit,
        CancellationToken cancellationToken);

    Task<bool> HasClosedWorkItemAsync(
        RoleAgentId roleAgentId,
        WorkItemId workItemId,
        CancellationToken cancellationToken);
}