namespace Aven.Scheduling.Contracts.Events;

public sealed record ScheduledRoleDeliveryAccepted(
    string OccurrenceId,
    DeliveryId DeliveryId,
    DateTimeOffset? AcceptedAt,
    string AcceptanceKind,
    DateTimeOffset? NextDueAt) : IAvenEvent;
