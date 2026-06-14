namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record OperationRequested(
    OperationId OperationId,
    RunId RunId,
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    OperationKey OperationKey,
    string TargetKind,
    string ContractId,
    string InputJson,
    DateTimeOffset RequestedAt) : IAvenEvent;