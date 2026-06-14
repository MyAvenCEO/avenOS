namespace Aven.Resources.Metadata.Contracts.Responses;

public sealed record MetadataCreateRejected(
    OperationKey Key,
    CorrelationId CorrelationId,
    OperationError Error)
    : MetadataCreateReply(Key, CorrelationId);
