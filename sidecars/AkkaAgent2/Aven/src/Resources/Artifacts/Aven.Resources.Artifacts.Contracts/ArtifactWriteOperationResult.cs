namespace Aven.Resources.Artifacts.Contracts;

public sealed record ArtifactWriteOperationResult(
    ArtifactId ArtifactId,
    ArtifactRevisionId RevisionId,
    string Filename,
    string MimeType,
    string? Hash = null,
    long? SizeBytes = null);