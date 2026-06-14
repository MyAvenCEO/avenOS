namespace Aven.Toolkit.Artifacts;

public sealed record ArtifactDescriptor(
    ArtifactId ArtifactId,
    ArtifactRevisionId CurrentRevisionId,
    string Filename,
    string MimeType,
    string SourceKind,
    DateTimeOffset CreatedAt,
    IReadOnlyList<ArtifactRevisionDescriptor> Revisions);