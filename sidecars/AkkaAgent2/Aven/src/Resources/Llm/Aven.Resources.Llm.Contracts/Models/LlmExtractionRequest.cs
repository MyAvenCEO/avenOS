namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmExtractionRequest(
    OperationKey Key,
    CorrelationId CorrelationId,
    ArtifactRef SourceArtifact,
    string ProviderName,
    LlmModelCapabilities Model,
    string Purpose,
    SchemaRef SchemaRef,
    string SchemaJson,
    string ExtractionPrompt,
    bool AllowTextFallback,
    bool PreferProviderFileUpload,
    CapabilityId? CapabilityId = null);
