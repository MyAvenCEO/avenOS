namespace Aven.Resources.Human.Contracts.Events;

public sealed record HumanPromptExpired(
    PromptId PromptId,
    DateTimeOffset ExpiredAt) : IAvenEvent;
