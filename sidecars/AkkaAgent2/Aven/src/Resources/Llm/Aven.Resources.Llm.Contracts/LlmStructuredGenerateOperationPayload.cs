namespace Aven.Resources.Llm.Contracts;

public sealed record LlmStructuredGenerateOperationPayload(
    string RequestId,
    IReadOnlyList<LlmStructuredInputBlock> Input,
    SchemaRef SchemaRef,
    string Purpose,
    string? Model = null,
    int MaxOutputTokens = 2048,
    int? MaxInputTokens = null,
    decimal? MaxCost = null,
    bool EnableReasoningSummary = false,
    int? ThinkingBudget = null,
    string? CapabilityId = null);

public sealed record LlmStructuredInputBlock(
    string Kind,
    string? Text = null,
    string? Json = null,
    string? Role = null);
