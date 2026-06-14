namespace Aven.Resources.Metadata.Contracts.Responses;

public sealed record MetadataCreateConflict(
    OperationKey Key,
    CorrelationId CorrelationId,
    OperationError Error)
    : MetadataCreateReply(Key, CorrelationId);
