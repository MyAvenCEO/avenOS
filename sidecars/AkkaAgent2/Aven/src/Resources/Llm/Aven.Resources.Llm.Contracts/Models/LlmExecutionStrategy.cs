namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmExecutionStrategy(
    bool StartExternalCallWithoutImmediateProviderExecution,
    bool RecoverableAfterRestart,
    OperationError? InFlightReplyError = null)
{
    public static LlmExecutionStrategy Immediate { get; } = new(false, false);
}