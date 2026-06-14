namespace Aven.WorkIntake.Contracts.Models;

public sealed record WorkStartDeliveryReceipt(
    DeliveryId DeliveryId,
    DeliveryStatus Status,
    DateTimeOffset? AcceptedAt,
    string? AcceptanceKind,
    OperationError? Error);
