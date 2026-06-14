namespace Aven.DurableDelivery.Contracts.State;

public sealed record DeliveryState(
    DeliveryId DeliveryId,
    ActorAddress Owner,
    string EnvelopeJson,
    ActorAddress Recipient,
    CommandId CommandId,
    string PayloadHash,
    DeliveryStatus Status,
    int Attempts,
    DateTimeOffset? NextAttemptAt,
    DateTimeOffset? AcceptedAt,
    OperationError? TerminalError)
{
    public bool IsTerminal => Status is DeliveryStatus.Accepted or DeliveryStatus.Rejected or DeliveryStatus.Expired or DeliveryStatus.Cancelled or DeliveryStatus.Quarantined;
}
