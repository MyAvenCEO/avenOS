namespace Aven.Resources.Metadata.Contracts;

public sealed record MetadataWriteOperationPayload(
    string RequestId,
    string SubjectKind,
    string SubjectId,
    SchemaRef SchemaRef,
    string Json,
    string? SourceSummary = null,
    ArtifactId? ArtifactId = null,
    ArtifactRevisionId? ArtifactRevisionId = null,
    string? CapabilityId = null);