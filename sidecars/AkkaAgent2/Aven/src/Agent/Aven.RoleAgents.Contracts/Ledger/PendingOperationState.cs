namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record PendingOperationState(
    OperationId OperationId,
    RunId RunId,
    WorkItemId WorkItemId,
    OperationKey OperationKey,
    string TargetKind,
    string ContractId,
    PersistedCommandPayload Input,
    DateTimeOffset RequestedAt);