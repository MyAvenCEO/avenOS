namespace Aven.Toolkit.Artifacts;

public sealed record ArtifactRevisionDescriptor(
    ArtifactRevisionId RevisionId,
    BlobRef Blob,
    DateTimeOffset CreatedAt,
    string? Description);