namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduleRegistered(
    string ScheduleId,
    OperationKey OperationKey,
    CorrelationId CorrelationId,
    DateTimeOffset DueAt,
    TimeSpan? Recurrence,
    MissedRunPolicy MissedRunPolicy) : IAvenEvent;
