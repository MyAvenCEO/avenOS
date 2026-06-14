namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduleMissedRunPromptRequested(DateTimeOffset OccurrenceDueAt, DateTimeOffset CheckedAt, string PromptText, DateTimeOffset? NextDueAt) : IAvenEvent;
