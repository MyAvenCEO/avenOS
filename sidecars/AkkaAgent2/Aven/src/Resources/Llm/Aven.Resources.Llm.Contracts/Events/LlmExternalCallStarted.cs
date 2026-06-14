namespace Aven.Resources.Llm.Contracts.Events;

public sealed record LlmExternalCallStarted(LlmRequestId LlmRequestId, OperationKey Key, DateTimeOffset StartedAt) : IAvenEvent;
