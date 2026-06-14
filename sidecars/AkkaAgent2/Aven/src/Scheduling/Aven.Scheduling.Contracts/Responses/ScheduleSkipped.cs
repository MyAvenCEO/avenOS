namespace Aven.Scheduling.Contracts.Responses;

public sealed record ScheduleSkipped(
    string ScheduleId,
    string OccurrenceId,
    DateTimeOffset DueAt,
    DateTimeOffset SkippedAt,
    string Reason,
    DateTimeOffset? NextDueAt);