namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkClaimCommitRequested(
    WorkOfferId OfferId,
    WorkClaimId ClaimId,
    string ExpectedCommandJsonHash,
    string ExpectedCommandType,
    DeliveryId DeliveryId,
    CommandId CommandId,
    MessageId MessageId,
    DateTimeOffset StartedAt) : IAvenEvent;
