namespace Aven.Scheduling.Contracts.Responses;

public sealed record ScheduleFired(string ScheduleId, ScheduledWorkItem WorkItem, DateTimeOffset? NextDueAt, string OccurrenceId);
