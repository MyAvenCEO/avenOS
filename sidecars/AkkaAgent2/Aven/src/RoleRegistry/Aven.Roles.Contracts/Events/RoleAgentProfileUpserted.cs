namespace Aven.Roles.Contracts.Events;

public sealed record RoleAgentProfileUpserted(
    RoleAgentId RoleAgentId,
    string RoleName,
    string DisplayName,
    string Objective,
    string ResponsibilityScope,
    string[] AcceptedInputTypes,
    SchemaRef[] PrimarySchemas,
    string RoutingDescription,
    string[] ExamplesOfRelevantInput,
    string[] ExamplesOfIrrelevantInput,
    string RecentSummary,
    string SchedulePolicy,
    string Status,
    string ExecutionMode = "HardCoded",
    string Hardness = "Hard",
    string? SystemPrompt = null,
    string[]? AllowedSkills = null) : IAvenEvent
{
    public static RoleAgentProfileUpserted FromProfile(RoleAgentProfile profile) => new(
        profile.RoleAgentId,
        profile.RoleName,
        profile.DisplayName,
        profile.Objective,
        profile.ResponsibilityScope,
        profile.AcceptedInputTypes.ToArray(),
        profile.PrimarySchemas.ToArray(),
        profile.RoutingDescription,
        profile.ExamplesOfRelevantInput.ToArray(),
        profile.ExamplesOfIrrelevantInput.ToArray(),
        profile.RecentSummary,
        profile.SchedulePolicy,
        profile.Status,
        profile.ExecutionMode,
        profile.Hardness,
        profile.SystemPrompt,
        profile.AllowedSkills?.ToArray());

    public RoleAgentProfile ToProfile() => new(
        RoleAgentId,
        RoleName,
        DisplayName,
        Objective,
        ResponsibilityScope,
        AcceptedInputTypes,
        PrimarySchemas,
        RoutingDescription,
        ExamplesOfRelevantInput,
        ExamplesOfIrrelevantInput,
        RecentSummary,
        SchedulePolicy,
        Status,
        ExecutionMode,
        Hardness,
        SystemPrompt,
        AllowedSkills ?? Array.Empty<string>());
}
