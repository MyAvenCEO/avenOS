namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduledRoleDeliveryRejected(
    string OccurrenceId,
    DeliveryId DeliveryId,
    OperationError Error,
    DateTimeOffset? NextDueAt) : IAvenEvent;
