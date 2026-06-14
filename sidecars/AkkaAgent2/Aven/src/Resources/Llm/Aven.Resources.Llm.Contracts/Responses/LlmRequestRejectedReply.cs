namespace Aven.Resources.Llm.Contracts.Responses;

public sealed record LlmRequestRejectedReply(OperationKey Key, CorrelationId CorrelationId, OperationError Error);
