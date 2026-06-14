namespace Aven.Api.Persistence.HumanPrompts;

internal sealed record HumanPromptTracked(
    PromptId PromptId,
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    ActorAddress ReplyTo,
    string PromptText,
    DateTimeOffset? ExpiresAt,
    CapabilityId? CapabilityId) : IAvenEvent;
