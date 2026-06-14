namespace Aven.Resources.Metadata.Contracts.Responses;

public abstract record MetadataCreateReply(
    OperationKey Key,
    CorrelationId CorrelationId);
