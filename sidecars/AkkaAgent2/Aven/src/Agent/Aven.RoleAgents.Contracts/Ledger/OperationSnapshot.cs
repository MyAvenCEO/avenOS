namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record OperationSnapshot(
    OperationId OperationId,
    RunId RunId,
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    OperationStatus Status,
    OperationKey OperationKey,
    string TargetKind,
    string ContractId,
    string InputJson,
    string? ResultJson,
    string? FailureReason,
    bool? Retryable,
    DateTimeOffset RequestedAt,
    DateTimeOffset? CompletedAt);