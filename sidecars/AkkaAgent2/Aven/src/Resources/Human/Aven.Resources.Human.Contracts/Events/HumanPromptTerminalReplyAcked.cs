namespace Aven.Resources.Human.Contracts.Events;

public sealed record HumanPromptTerminalReplyAcked(
    PromptId PromptId,
    DateTimeOffset AcknowledgedAt) : IAvenEvent;
