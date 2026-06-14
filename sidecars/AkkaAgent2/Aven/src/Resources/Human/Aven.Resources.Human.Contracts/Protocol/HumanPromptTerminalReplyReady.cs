namespace Aven.Resources.Human.Contracts.Protocol;

public sealed record HumanPromptTerminalReplyReady(
    PromptId PromptId,
    OperationKey Key,
    CorrelationId CorrelationId,
    HumanPromptStatus Status,
    string? ResolvedCapabilityId = null,
    string? Answer = null,
    DateTimeOffset? AnsweredAt = null,
    string? CancelReason = null,
    OperationError? Error = null);