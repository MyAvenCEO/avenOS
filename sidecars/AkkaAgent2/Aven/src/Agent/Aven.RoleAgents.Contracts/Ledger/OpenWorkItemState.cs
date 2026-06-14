namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record OpenWorkItemState(
    WorkItemId WorkItemId,
    string Subject,
    string? InputSummary,
    ArtifactRef? InputArtifact,
    DateTimeOffset OpenedAt);