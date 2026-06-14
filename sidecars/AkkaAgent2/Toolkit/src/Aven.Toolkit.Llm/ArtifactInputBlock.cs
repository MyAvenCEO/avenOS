namespace Aven.Toolkit.Llm;

public sealed record ArtifactInputBlock(
    LlmBlockKind ArtifactKind,
    ArtifactId ArtifactId,
    string MimeType,
    string? InlineTransportData = null) : LlmInputBlock(ArtifactKind);