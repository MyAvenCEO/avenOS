namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmRequest(
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    ActorAddress ReplyTo,
    LlmModelCapabilities Model,
    IReadOnlyList<LlmInputBlock> Input,
    StructuredOutputContract? StructuredOutput,
    IReadOnlyList<ProviderFileDescriptor> ProviderFiles,
    LlmReasoningOptions Reasoning,
    LlmBudgetLimits Budget,
    LlmSafetySettings Safety,
    CapabilityId? CapabilityId = null);
