namespace Aven.Roles.Contracts.Models;

public sealed record RoleAgentProfile(
    RoleAgentId RoleAgentId,
    string RoleName,
    string DisplayName,
    string Objective,
    string ResponsibilityScope,
    IReadOnlyList<string> AcceptedInputTypes,
    IReadOnlyList<SchemaRef> PrimarySchemas,
    string RoutingDescription,
    IReadOnlyList<string> ExamplesOfRelevantInput,
    IReadOnlyList<string> ExamplesOfIrrelevantInput,
    string RecentSummary,
    string SchedulePolicy,
    string Status,
    string ExecutionMode = "HardCoded",
    string Hardness = "Hard",
    string? SystemPrompt = null,
    IReadOnlyList<string>? AllowedSkills = null);
