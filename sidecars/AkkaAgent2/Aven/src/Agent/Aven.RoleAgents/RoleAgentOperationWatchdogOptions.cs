namespace Aven.RoleAgents;

public sealed record RoleAgentOperationWatchdogOptions(
    TimeSpan? DefaultTimeout,
    IReadOnlyDictionary<string, TimeSpan?> TargetKindTimeouts,
    IReadOnlyDictionary<string, TimeSpan?> ContractIdTimeouts,
    bool TimeoutRetryable)
{
    public static RoleAgentOperationWatchdogOptions ProductionDefault { get; } = new(
        DefaultTimeout: TimeSpan.FromMinutes(2),
        TargetKindTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase)
        {
            [ResourceKinds.Llm] = TimeSpan.FromMinutes(2),
            [ResourceKinds.Artifact] = TimeSpan.FromSeconds(30),
            [ResourceKinds.Metadata] = TimeSpan.FromSeconds(30),
            [ResourceKinds.Schedule] = TimeSpan.FromSeconds(30),
            [ResourceKinds.Human] = null
        },
        ContractIdTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase)
        {
            [ResourceOperationTypes.HumanApprove] = null
        },
        TimeoutRetryable: true);

    public static RoleAgentOperationWatchdogOptions Disabled { get; } = new(
        DefaultTimeout: null,
        TargetKindTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase),
        ContractIdTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase),
        TimeoutRetryable: true);

    public TimeSpan? ResolveTimeout(PendingOperationState operation)
    {
        ArgumentNullException.ThrowIfNull(operation);

        if (ContractIdTimeouts.TryGetValue(operation.ContractId, out var contractTimeout))
        {
            return contractTimeout;
        }

        if (TargetKindTimeouts.TryGetValue(operation.TargetKind, out var targetKindTimeout))
        {
            return targetKindTimeout;
        }

        return DefaultTimeout;
    }
}