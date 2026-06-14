namespace Aven.Scheduling.Contracts.Responses;

public sealed record SchedulePromptRequested(string ScheduleId, string PromptText, DateTimeOffset? NextDueAt);
