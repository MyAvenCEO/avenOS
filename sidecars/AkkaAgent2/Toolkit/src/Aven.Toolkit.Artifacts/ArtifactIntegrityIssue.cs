namespace Aven.Toolkit.Artifacts;

public sealed record ArtifactIntegrityIssue(
    string Code,
    string Severity,
    ArtifactId? ArtifactId,
    ArtifactRevisionId? RevisionId,
    BlobRef? Blob,
    string Message);