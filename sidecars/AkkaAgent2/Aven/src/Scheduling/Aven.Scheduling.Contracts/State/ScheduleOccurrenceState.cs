namespace Aven.Scheduling.Contracts.State;

public sealed record ScheduleOccurrenceState(
    string OccurrenceId,
    DateTimeOffset DueAt,
    DateTimeOffset DetectedAt,
    ScheduledWorkItem WorkItem,
    DeliveryId DeliveryId,
    CommandId CommandId,
    MessageId MessageId,
    int DeliveryAttemptCount,
    ScheduleOccurrenceStatus Status,
    ScheduledDeliveryReceipt? Delivery,
    OperationError? Error);
