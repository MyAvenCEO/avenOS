namespace Aven.Resources.Metadata.Contracts;

public sealed record MetadataQueryOperationResult(
    IReadOnlyList<MetadataRecordSnapshot> Records,
    bool TimedOut,
    int AppliedLimit);

public sealed record MetadataRecordSnapshot(
    string RecordId,
    string SubjectKind,
    string SubjectId,
    string? ArtifactId,
    string? ArtifactRevisionId,
    string SchemaRef,
    string Json,
    string PayloadHash,
    DateTimeOffset CreatedAt,
    string? SourceSummary);
