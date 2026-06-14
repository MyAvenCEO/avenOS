namespace Aven.Resources.Human.Contracts.Responses;

public sealed record HumanPromptAnswerAccepted(PromptId PromptId, string Answer, bool Idempotent, bool Late);
