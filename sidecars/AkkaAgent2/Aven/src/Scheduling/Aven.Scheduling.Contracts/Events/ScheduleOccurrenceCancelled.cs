namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduleOccurrenceCancelled(
    string OccurrenceId,
    DeliveryId DeliveryId,
    DateTimeOffset CancelledAt,
    string Reason) : IAvenEvent;