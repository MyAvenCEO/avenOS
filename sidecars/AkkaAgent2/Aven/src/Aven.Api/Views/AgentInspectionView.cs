namespace Aven.Api.Views;

public sealed record AgentInspectionView(
    string RoleAgentId,
    string Status,
    string RoleName,
    string RoleDisplayName,
    string Objective,
    string? RoleMemoryJson,
    string? LastRunSummary,
    IReadOnlyList<OpenWorkItemState> OpenWorkItems,
    IReadOnlyList<ActiveRunState> ActiveRuns,
    IReadOnlyList<PendingOperationState> PendingOperations);