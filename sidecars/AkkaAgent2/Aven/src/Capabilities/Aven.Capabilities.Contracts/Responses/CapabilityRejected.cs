namespace Aven.Capabilities.Contracts.Responses;

public sealed record CapabilityRejected(CapabilityId CapabilityId, OperationKey OperationKey, OperationError Error);
