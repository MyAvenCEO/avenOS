namespace Aven.Resources.Human.Contracts.Events;

public sealed record HumanPromptCancelled(
    PromptId PromptId,
    string Reason,
    DateTimeOffset CancelledAt) : IAvenEvent;