namespace Aven.Contracts.Operations;

public abstract record OperationReply(
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    ActorAddress? Worker);
