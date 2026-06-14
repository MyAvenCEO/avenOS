namespace Aven.Resources.Llm.Contracts.Events;

public sealed record LlmRequestRejectedByPolicy(LlmRequestId LlmRequestId, OperationKey Key, OperationError Error) : IAvenEvent;
