namespace Aven.Resources.Human.Contracts.Commands;

public sealed record HumanPromptCancel(PromptId PromptId, string? Reason, DateTimeOffset? CancelledAt = null);