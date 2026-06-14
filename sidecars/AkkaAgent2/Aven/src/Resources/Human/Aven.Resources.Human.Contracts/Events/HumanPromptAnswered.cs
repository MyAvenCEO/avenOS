namespace Aven.Resources.Human.Contracts.Events;

public sealed record HumanPromptAnswered(
    PromptId PromptId,
    string Answer,
    DateTimeOffset AnsweredAt) : IAvenEvent;
