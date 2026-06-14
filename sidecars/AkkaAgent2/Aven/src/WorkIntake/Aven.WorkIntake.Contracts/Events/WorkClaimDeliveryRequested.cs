namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkClaimDeliveryRequested(
    WorkOfferId OfferId,
    WorkClaimId ClaimId,
    DeliveryId DeliveryId,
    CommandId CommandId) : IAvenEvent;
