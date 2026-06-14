namespace Aven.Resources.Metadata.Contracts.Responses;

public sealed record MetadataCreateSucceeded(
    OperationKey Key,
    CorrelationId CorrelationId,
    MetadataRecord Record,
    bool Idempotent)
    : MetadataCreateReply(Key, CorrelationId);
