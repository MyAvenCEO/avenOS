namespace Aven.Contracts.Operations;

public sealed record OperationCancelled(
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    ActorAddress? Worker)
    : OperationReply(Key, CorrelationId, Adapter, Worker);
