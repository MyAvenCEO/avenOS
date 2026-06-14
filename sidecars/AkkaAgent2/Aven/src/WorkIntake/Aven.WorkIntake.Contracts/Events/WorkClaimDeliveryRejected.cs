namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkClaimDeliveryRejected(
    WorkOfferId OfferId,
    OperationError Error,
    DeliveryId? DeliveryId = null,
    DeliveryStatus? DeliveryStatus = null,
    DateTimeOffset? AcceptedAt = null,
    string? AcceptanceKind = null,
    OperationError? DeliveryError = null) : IAvenEvent;
