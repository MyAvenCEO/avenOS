namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record OperationFailed(
    OperationId OperationId,
    RunId RunId,
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    OperationKey OperationKey,
    string ContractId,
    string Reason,
    bool Retryable,
    DateTimeOffset FailedAt) : IAvenEvent;