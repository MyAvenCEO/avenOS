namespace Aven.Resources.Metadata.Contracts.Models;

public sealed record MetadataCreateRequest(
    OperationKey Key,
    CorrelationId CorrelationId,
    MetadataSubject Subject,
    SchemaRef SchemaRef,
    string Json,
    string? SourceSummary = null,
    CapabilityId? CapabilityId = null);
