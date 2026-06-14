namespace Aven.Resources.Human.Contracts.Responses;

public sealed record HumanPromptCancellationAccepted(PromptId PromptId, string Reason, bool Idempotent);