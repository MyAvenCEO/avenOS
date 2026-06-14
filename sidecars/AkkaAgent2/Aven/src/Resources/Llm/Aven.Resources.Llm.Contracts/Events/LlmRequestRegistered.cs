namespace Aven.Resources.Llm.Contracts.Events;

public sealed record LlmRequestRegistered(
    LlmRequestId LlmRequestId,
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    ActorAddress ReplyTo,
    string Provider,
    string Model,
    LlmInputBlockSummary[] InputBlocks,
    LlmStructuredOutputSummary? StructuredOutput,
    ProviderFileKey[] ProviderFiles,
    LlmReasoningOptions Reasoning,
    LlmBudgetLimits Budget,
    LlmSafetySettings Safety,
    CapabilityId? CapabilityId) : IAvenEvent;
