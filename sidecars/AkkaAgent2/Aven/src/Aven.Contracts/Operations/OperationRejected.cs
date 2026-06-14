namespace Aven.Contracts.Operations;

public sealed record OperationRejected(
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    OperationError Error)
    : OperationReply(Key, CorrelationId, Adapter, null);
