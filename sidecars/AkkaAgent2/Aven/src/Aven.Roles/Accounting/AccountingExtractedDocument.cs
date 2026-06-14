namespace Aven.Roles.Accounting;

public sealed record AccountingExtractedDocument(
    string DocumentKind,
    ArtifactRef SourceArtifact,
    SchemaRef SchemaRef,
    string StructuredJson,
    string? Explanation = null);
