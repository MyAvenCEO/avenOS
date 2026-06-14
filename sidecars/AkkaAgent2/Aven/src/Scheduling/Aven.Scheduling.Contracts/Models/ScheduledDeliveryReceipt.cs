namespace Aven.Scheduling.Contracts.Models;

public sealed record ScheduledDeliveryReceipt(
    DeliveryId DeliveryId,
    DeliveryStatus Status,
    DateTimeOffset? AcceptedAt,
    string? AcceptanceKind,
    OperationError? Error);
