namespace Aven.Resources.Llm.Contracts.Commands;

public sealed record LlmStructuredGenerationCommand(
    RequestId RequestId,
    ActorAddress Caller,
    CorrelationId CorrelationId,
    LlmModelCapabilities Model,
    IReadOnlyList<LlmInputBlock> Input,
    SchemaRef SchemaRef,
    string Purpose,
    LlmReasoningOptions Reasoning,
    LlmBudgetLimits Budget,
    LlmSafetySettings Safety,
    CapabilityId? CapabilityId);