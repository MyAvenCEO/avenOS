namespace Aven.Resources.Human.Contracts.Responses;

public sealed record HumanPromptCancellationRejected(PromptId PromptId, OperationError Error);