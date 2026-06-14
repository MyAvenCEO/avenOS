namespace Aven.Resources.Human.Contracts.Events;

public sealed record HumanPromptLateAnswerRecorded(
    PromptId PromptId,
    string Answer,
    DateTimeOffset AnsweredAt) : IAvenEvent;
