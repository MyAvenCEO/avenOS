namespace Aven.Api.Requests;

public sealed record CreateAgentRequest(
    string RoleAgentId,
    string RoleName,
    string DisplayName,
    string Objective,
    string ResponsibilityScope,
    IReadOnlyList<string>? AcceptedInputTypes = null,
    IReadOnlyList<string>? PrimarySchemas = null,
    string? RoutingDescription = null,
    IReadOnlyList<string>? ExamplesOfRelevantInput = null,
    IReadOnlyList<string>? ExamplesOfIrrelevantInput = null,
    string? RecentSummary = null,
    string? SchedulePolicy = null,
    string? Status = null,
    string? ExecutionMode = null,
    string? Hardness = null,
    string? SystemPrompt = null,
    IReadOnlyList<string>? AllowedSkills = null);
