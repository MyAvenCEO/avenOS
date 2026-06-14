namespace Aven.Toolkit.Llm;

public sealed record LlmInputBlockSummary(
    LlmBlockKind Kind,
    string? Text = null,
    string? Role = null,
    ProviderFileKey? ProviderFileKey = null,
    ArtifactId? ArtifactId = null,
    string? MimeType = null,
    string? Purpose = null,
    string? TransportMode = null,
    string? PayloadHash = null,
    int? TextLength = null,
    string? Name = null);