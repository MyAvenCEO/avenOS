namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduleCancelled(DateTimeOffset CancelledAt, string Reason) : IAvenEvent;
