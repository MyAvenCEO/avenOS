namespace Aven.Roles.Dynamic.Models;

public sealed record DynamicRoleState(
    int StepCount,
    string? CurrentGoalSummary,
    IReadOnlyList<DynamicRoleObservation> RecentObservations,
    string? LastPlannerSummary)
{
    public static DynamicRoleState Empty { get; } = new(0, null, Array.Empty<DynamicRoleObservation>(), null);
}

public sealed record DynamicRoleObservation(
    string Kind,
    string Summary,
    string? Json,
    DateTimeOffset ObservedAt);
