namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduledRoleDeliveryRequested(string OccurrenceId, DeliveryId DeliveryId) : IAvenEvent;
