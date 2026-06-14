namespace Aven.Resources.Llm.Contracts.Models;

public sealed record ExtractionEvidenceAnchor(
    ArtifactId ArtifactId,
    ArtifactRevisionId RevisionId,
    string MimeType,
    string Locator,
    bool IsDegraded);
