namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduleOccurrenceRecorded(
    string ScheduleId,
    string OccurrenceId,
    DateTimeOffset DueAt,
    DateTimeOffset DetectedAt,
    ScheduledWorkItem WorkItem,
    string PayloadHash,
    int PayloadSizeBytes,
    DeliveryId DeliveryId,
    CommandId CommandId,
    MessageId MessageId,
    DateTimeOffset? NextDueAt) : IAvenEvent;
