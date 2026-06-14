namespace Aven.Resources.Human.Contracts.Models;

public sealed record HumanPromptAnswer(PromptId PromptId, string Answer, DateTimeOffset? AnsweredAt = null, CapabilityId? CapabilityId = null);
