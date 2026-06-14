namespace Aven.Resources.Artifacts.Contracts;

public sealed record ArtifactWriteOperationPayload(
    string RequestId,
    ArtifactId? ArtifactId,
    bool Append,
    string Filename,
    string MimeType,
    string SourceKind,
    string Content,
    string? Description = null,
    SchemaRef? SchemaRef = null,
    string? EvidenceJson = null,
    string? CapabilityId = null);