namespace Aven.Toolkit.Metadata;

public sealed record MetadataRecord(
    string RecordId,
    MetadataSubject Subject,
    SchemaRef SchemaRef,
    string Json,
    string PayloadHash,
    DateTimeOffset CreatedAt,
    string? SourceSummary = null);
