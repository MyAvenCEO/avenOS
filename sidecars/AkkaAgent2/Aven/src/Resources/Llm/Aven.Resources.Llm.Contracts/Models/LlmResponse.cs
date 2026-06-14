namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmResponse(
    string Provider,
    string Model,
    string? Text,
    string? StructuredJson,
    IReadOnlyList<LlmToolCall> ToolCalls,
    string? Refusal,
    string? SafetyBlock,
    string? ReasoningSummary,
    IReadOnlyList<string> Citations,
    LlmUsage Usage,
    string FinishReason,
    IReadOnlyList<LlmProviderDegradation> Degradations,
    SchemaRef? SchemaRef,
    bool StructuredOutputValidated);
