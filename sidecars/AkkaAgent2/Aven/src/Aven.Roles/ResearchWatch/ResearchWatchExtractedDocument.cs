namespace Aven.Roles.ResearchWatch;

public sealed record ResearchWatchExtractedDocument(
    ArtifactRef SourceArtifact,
    SchemaRef SchemaRef,
    string StructuredJson,
    string? Explanation = null);
