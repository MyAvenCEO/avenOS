namespace Aven.Scheduling.Contracts.Responses;

public sealed record ScheduleDeliveryRequested(string ScheduleId, string OccurrenceId, ScheduledWorkItem WorkItem, DateTimeOffset? NextDueAt);
