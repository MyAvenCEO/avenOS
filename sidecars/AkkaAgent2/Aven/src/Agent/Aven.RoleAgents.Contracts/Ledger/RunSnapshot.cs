namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record RunSnapshot(
    RunId RunId,
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    RunStatus Status,
    string Goal,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    string? Summary,
    string? BlockedReason,
    string? FailureReason);