namespace Aven.Contracts.Operations;

public sealed record OperationResolved(
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    ActorAddress ResolvedBy,
    OperationValue Value)
    : OperationReply(Key, CorrelationId, Adapter, ResolvedBy);
