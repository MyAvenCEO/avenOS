namespace Aven.Roles.ContractWatcher;

public sealed record ContractWatcherExtractedDocument(
    ArtifactRef SourceArtifact,
    SchemaRef SchemaRef,
    string StructuredJson,
    string? Explanation = null);
