namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkCommitted(
    WorkClaimId ClaimId,
    DeliveryId DeliveryId,
    DeliveryStatus DeliveryStatus,
    DateTimeOffset? AcceptedAt,
    string? AcceptanceKind,
    OperationError? DeliveryError) : IAvenEvent;
