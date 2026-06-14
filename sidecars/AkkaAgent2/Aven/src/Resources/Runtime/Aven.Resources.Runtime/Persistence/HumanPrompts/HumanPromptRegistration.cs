namespace Aven.Resources.Runtime.Persistence.HumanPrompts;

public sealed record HumanPromptRegistration(
    string PromptId,
    string CallerValue,
    string CallerProtocol,
    string RequestId,
    string OperationType,
    string CorrelationId,
    string AdapterValue,
    string AdapterProtocol,
    string ReplyToValue,
    string ReplyToProtocol,
    string PromptText,
    DateTimeOffset? ExpiresAt,
    string? CapabilityId);