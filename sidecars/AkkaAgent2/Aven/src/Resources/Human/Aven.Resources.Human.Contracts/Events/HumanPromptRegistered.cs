namespace Aven.Resources.Human.Contracts.Events;

public sealed record HumanPromptRegistered(
    PromptId PromptId,
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    string PromptText,
    DateTimeOffset? ExpiresAt,
    string? CapabilityId) : IAvenEvent;
