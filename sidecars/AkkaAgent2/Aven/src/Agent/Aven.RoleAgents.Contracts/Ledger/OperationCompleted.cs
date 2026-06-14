namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record OperationCompleted(
    OperationId OperationId,
    RunId RunId,
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    OperationKey OperationKey,
    string ContractId,
    string ResultJson,
    DateTimeOffset CompletedAt) : IAvenEvent;