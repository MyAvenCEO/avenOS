namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record WorkItemSnapshot(
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    WorkItemStatus Status,
    string Subject,
    string? InputSummary,
    ArtifactRef? InputArtifact,
    DateTimeOffset OpenedAt,
    DateTimeOffset? ClosedAt,
    string? Outcome);