namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record WorkItemOpened(
    WorkItemId WorkItemId,
    RoleAgentId RoleAgentId,
    string Subject,
    string? InputSummary,
    ArtifactRef? InputArtifact,
    DateTimeOffset OpenedAt) : IAvenEvent;