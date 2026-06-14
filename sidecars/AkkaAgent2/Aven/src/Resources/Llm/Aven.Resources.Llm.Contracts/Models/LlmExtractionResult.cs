namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmExtractionResult(
    OperationKey Key,
    CorrelationId CorrelationId,
    ArtifactSourceDescriptor SourceArtifact,
    string Provider,
    string Model,
    SchemaRef SchemaRef,
    string StructuredJson,
    bool SchemaValidated,
    IReadOnlyList<string> ValidationErrors,
    IReadOnlyList<ExtractionEvidenceAnchor> Evidence,
    IReadOnlyList<LlmProviderDegradation> Degradations,
    LlmUsage Usage,
    string FinishReason,
    string TransportSummary,
    string PromptSummary);
