namespace Aven.Contracts.Operations;

public sealed record OperationKey(
    ActorAddress Caller,
    RequestId RequestId,
    string OperationType);
