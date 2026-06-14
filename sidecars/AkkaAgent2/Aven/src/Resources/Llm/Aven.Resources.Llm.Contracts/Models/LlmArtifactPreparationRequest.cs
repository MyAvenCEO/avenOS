namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmArtifactPreparationRequest(
    string ProviderName,
    string? AdapterProtocol,
    LlmModelCapabilities Model,
    ArtifactSourceDescriptor Artifact,
    string Purpose,
    bool AllowTextFallback = false,
    bool PreferProviderFileUpload = false,
    string TextFallbackTransportMode = "inline_text");
