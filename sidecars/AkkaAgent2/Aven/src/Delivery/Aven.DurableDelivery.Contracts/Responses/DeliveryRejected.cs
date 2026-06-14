namespace Aven.DurableDelivery.Contracts.Responses;

public sealed record DeliveryRejected(
    DeliveryId DeliveryId,
    CommandId CommandId,
    ActorAddress Recipient,
    OperationError Error);
