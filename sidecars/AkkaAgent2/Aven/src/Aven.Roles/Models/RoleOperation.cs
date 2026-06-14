namespace Aven.Roles.Models;

public sealed record RoleOperation(
    string ProviderKind,
    string RequestId,
    CorrelationId CorrelationId,
    string TargetOperationType,
    PersistedCommandPayload Payload);
