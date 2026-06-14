namespace Aven.Scheduling.Contracts.State;

public sealed record ScheduleState(
    string ScheduleId,
    OperationKey OperationKey,
    CorrelationId CorrelationId,
    DateTimeOffset DueAt,
    TimeSpan? Recurrence,
    MissedRunPolicy MissedRunPolicy,
    ScheduleStatus Status,
    DateTimeOffset? LastCompletedDueAt,
    DateTimeOffset? LastAcceptedDueAt,
    IReadOnlyList<ScheduledWorkItem> FiredWork,
    IReadOnlyDictionary<string, ScheduleOccurrenceState> Occurrences,
    string? PendingOccurrenceId,
    string? PendingPrompt,
    int DueCount,
    int FireCount)
{
    public static ScheduleState Create(
        string scheduleId,
        OperationKey operationKey,
        CorrelationId correlationId,
        DateTimeOffset dueAt,
        TimeSpan? recurrence,
        MissedRunPolicy missedRunPolicy) =>
        new(
            scheduleId,
            operationKey,
            correlationId,
            dueAt,
            recurrence,
            missedRunPolicy,
            ScheduleStatus.Active,
            null,
            null,
            Array.Empty<ScheduledWorkItem>(),
            new Dictionary<string, ScheduleOccurrenceState>(StringComparer.Ordinal),
            null,
            null,
            0,
            0);
}
