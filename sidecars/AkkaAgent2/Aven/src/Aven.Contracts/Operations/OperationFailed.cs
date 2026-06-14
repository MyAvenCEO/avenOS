namespace Aven.Contracts.Operations;

public sealed record OperationFailed(
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    ActorAddress? Worker,
    OperationError Error)
    : OperationReply(Key, CorrelationId, Adapter, Worker);
