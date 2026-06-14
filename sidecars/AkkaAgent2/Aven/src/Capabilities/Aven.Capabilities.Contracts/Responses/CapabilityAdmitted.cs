namespace Aven.Capabilities.Contracts.Responses;

public sealed record CapabilityAdmitted(CapabilityId CapabilityId, OperationKey OperationKey, int TotalUsesConsumed);
