namespace Aven.Resources.Llm.Contracts.Responses;

public sealed record LlmRequestSucceededReply(OperationKey Key, CorrelationId CorrelationId, LlmResponse Response);
