namespace Aven.RoleAgents.Runtime;

internal sealed record AcceptedRoleWorkInput(
    WorkItemId WorkItemId,
    string Subject,
    string? InputSummary,
    ArtifactRef? InputArtifact,
    string Goal,
    OperationResolved Resolved,
    CorrelationId CorrelationId);