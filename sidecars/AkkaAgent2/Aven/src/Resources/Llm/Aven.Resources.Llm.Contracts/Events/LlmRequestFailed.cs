namespace Aven.Resources.Llm.Contracts.Events;

public sealed record LlmRequestFailed(LlmRequestId LlmRequestId, OperationKey Key, OperationError Error) : IAvenEvent;
