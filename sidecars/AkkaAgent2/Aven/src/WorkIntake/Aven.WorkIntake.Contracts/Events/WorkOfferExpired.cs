namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkOfferExpired(
    WorkOfferId OfferId,
    WorkClaimId ClaimId,
    DateTimeOffset ExpiredAt,
    OperationError Error) : IAvenEvent;
