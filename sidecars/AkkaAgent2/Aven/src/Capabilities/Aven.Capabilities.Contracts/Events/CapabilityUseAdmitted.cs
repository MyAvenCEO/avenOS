namespace Aven.Capabilities.Contracts.Events;

public sealed record CapabilityUseAdmitted(CapabilityId CapabilityId, OperationKey OperationKey, DateTimeOffset AdmittedAt) : IAvenEvent;
