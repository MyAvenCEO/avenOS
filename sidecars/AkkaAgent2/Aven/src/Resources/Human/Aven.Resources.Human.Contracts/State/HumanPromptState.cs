namespace Aven.Resources.Human.Contracts.State;

public sealed record HumanPromptState(
    PromptId PromptId,
    OperationKey Key,
    CorrelationId CorrelationId,
    ActorAddress Adapter,
    string PromptText,
    DateTimeOffset? ExpiresAt,
    string? CapabilityId,
    HumanPromptStatus Status,
    string? CancelReason,
    DateTimeOffset? CancelledAt,
    string? Answer,
    DateTimeOffset? AnsweredAt,
    IReadOnlyList<LateHumanAnswer> LateAnswers,
    bool TerminalReplyPending,
    bool TerminalReplyAcknowledged)
{
    public static HumanPromptState Create(
        PromptId promptId,
        OperationKey key,
        CorrelationId correlationId,
        ActorAddress adapter,
        string promptText,
        DateTimeOffset? expiresAt,
        string? capabilityId) =>
        new(promptId, key, correlationId, adapter, promptText, expiresAt, capabilityId, HumanPromptStatus.Open, null, null, null, null, Array.Empty<LateHumanAnswer>(), false, false);
}
