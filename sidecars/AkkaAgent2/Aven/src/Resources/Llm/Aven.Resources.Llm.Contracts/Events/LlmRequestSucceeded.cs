namespace Aven.Resources.Llm.Contracts.Events;

public sealed record LlmRequestSucceeded(
    LlmRequestId LlmRequestId,
    OperationKey Key,
    string Provider,
    string Model,
    string? Text,
    string? StructuredJson,
    LlmToolCall[] ToolCalls,
    string? Refusal,
    string? SafetyBlock,
    string? ReasoningSummary,
    string[] Citations,
    SchemaRef? SchemaRef,
    bool StructuredOutputValidated,
    string FinishReason,
    int PromptTokens,
    int CompletionTokens,
    decimal Cost,
    LlmProviderDegradation[] Degradations) : IAvenEvent;
