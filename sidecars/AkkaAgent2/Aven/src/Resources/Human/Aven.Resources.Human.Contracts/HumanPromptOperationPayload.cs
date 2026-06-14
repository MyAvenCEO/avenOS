namespace Aven.Resources.Human.Contracts;

public sealed record HumanPromptOperationPayload(
    string RequestId,
    string PromptText,
    string? CapabilityId = null,
    DateTimeOffset? ExpiresAt = null);