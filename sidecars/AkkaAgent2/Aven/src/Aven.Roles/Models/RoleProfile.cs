namespace Aven.Roles.Models;

public sealed record RoleProfile(
    string RoleName,
    string DisplayName,
    string ResponsibilityScope,
    IReadOnlyList<string> AcceptedInputTypes,
    IReadOnlyList<SchemaRef> PrimarySchemas,
    string RoutingDescription,
    string SchedulePolicy,
    string? RecentSummary = null,
    IReadOnlyList<string>? ExamplesOfRelevantInput = null,
    IReadOnlyList<string>? ExamplesOfIrrelevantInput = null,
    RoleExecutionMode ExecutionMode = RoleExecutionMode.HardCoded,
    RoleHardness Hardness = RoleHardness.Hard,
    string? SystemPrompt = null,
    IReadOnlyList<string>? AllowedSkills = null);
