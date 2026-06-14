namespace Aven.Resources.Llm.Contracts.Responses;

public sealed record LlmRequestFailedReply(OperationKey Key, CorrelationId CorrelationId, OperationError Error);
