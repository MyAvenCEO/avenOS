namespace Aven.Scheduling.Contracts.Enums;

public enum ScheduleOccurrenceStatus
{
    DueDetected,
    DeliveryRequested,
    DeliveryAccepted,
    DeliveryRejected,
    Skipped,
    PromptRequested,
    Cancelled
}
