namespace Aven.Toolkit.Artifacts;

public sealed record ArtifactQuery(
    string? FilenameContains,
    string? MimeType,
    string? SourceKind,
    int? Limit);