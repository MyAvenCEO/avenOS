namespace Aven.Api.Views;

public sealed record HumanPromptView(
    string PromptId,
    string Status,
    string PromptText,
    string RequestId,
    string OperationType,
    string CorrelationId,
    string Caller,
    string Owner,
    string ReplyTo,
    string? RequiredCapabilityId,
    string? Answer,
    DateTimeOffset? AnsweredAt,
    DateTimeOffset? ExpiresAt);
