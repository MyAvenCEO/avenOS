namespace Aven.Capabilities.Contracts.Models;

public sealed record CapabilityAdmissionRequest(
    CapabilityId CapabilityId,
    OperationKey OperationKey,
    ActorAddress Target,
    string MessageType,
    DateTimeOffset RequestedAt,
    IReadOnlyDictionary<string, string>? ResourceAttributes = null);
