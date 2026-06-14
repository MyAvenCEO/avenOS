namespace Aven.Resources.Human.Contracts.Responses;

public sealed record HumanPromptAnswerRejected(PromptId PromptId, OperationError Error);
