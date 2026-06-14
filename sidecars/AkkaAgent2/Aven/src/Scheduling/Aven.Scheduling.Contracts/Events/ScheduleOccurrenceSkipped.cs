namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduleOccurrenceSkipped(
    string ScheduleId,
    string OccurrenceId,
    DateTimeOffset DueAt,
    DateTimeOffset SkippedAt,
    string Reason,
    DateTimeOffset? NextDueAt) : IAvenEvent;