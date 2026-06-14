namespace Aven.Toolkit.Artifacts;

public sealed record ArtifactRef(
    ArtifactId ArtifactId,
    ArtifactRevisionId? RevisionId = null);