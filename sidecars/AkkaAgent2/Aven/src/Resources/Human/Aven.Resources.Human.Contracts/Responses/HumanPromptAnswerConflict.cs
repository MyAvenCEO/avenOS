namespace Aven.Resources.Human.Contracts.Responses;

public sealed record HumanPromptAnswerConflict(PromptId PromptId, OperationError Error);
