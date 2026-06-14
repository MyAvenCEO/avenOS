namespace Aven.WorkIntake.Contracts.Models;

public sealed record WorkClaimCommitRecord(
    WorkOfferId OfferId,
    WorkClaimId ClaimId,
    WorkOfferAcceptedDecision Accepted,
    CorrelationId CorrelationId,
    string ExpectedCommandJson,
    string ExpectedCommandType,
    DeliveryId DeliveryId,
    CommandId CommandId,
    MessageId MessageId,
    DateTimeOffset StartedAt,
    WorkStartDeliveryReceipt? TerminalDelivery = null);
