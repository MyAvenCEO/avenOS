using System.Text.Json;
using OperationTimedOutReply = Aven.Contracts.Operations.OperationTimedOut;

namespace Aven.RoleAgents.Runtime;

internal sealed record RoleAgentOperationWatchdogPlan(OperationId OperationId, DateTimeOffset Deadline, TimeSpan Delay);

internal static class RoleAgentOperationWatchdogPlanner
{
    public static RoleAgentOperationWatchdogPlan? TryPlan(PendingOperationState operation, RoleAgentOperationWatchdogOptions options, DateTimeOffset now)
    {
        var timeout = options.ResolveTimeout(operation);
        if (timeout is null)
        {
            return null;
        }

        var deadline = operation.RequestedAt + timeout.Value;
        var delay = deadline - now;
        if (delay < TimeSpan.Zero)
        {
            delay = TimeSpan.Zero;
        }

        return new RoleAgentOperationWatchdogPlan(operation.OperationId, deadline, delay);
    }

    public static OperationTimedOutReply BuildTimeoutReply(
        PendingOperationState pendingOperation,
        RoleAgentOperationWatchdogOptions options,
        ActorAddress selfAddress,
        DateTimeOffset deadline)
    {
        var timeout = options.ResolveTimeout(pendingOperation)
            ?? throw new InvalidOperationException($"Operation '{pendingOperation.OperationId.Value}' does not have a watchdog timeout.");

        var detailsJson = JsonSerializer.Serialize(new
        {
            operationId = pendingOperation.OperationId.Value,
            runId = pendingOperation.RunId.Value,
            workItemId = pendingOperation.WorkItemId.Value,
            targetKind = pendingOperation.TargetKind,
            contractId = pendingOperation.ContractId,
            requestedAt = pendingOperation.RequestedAt,
            deadline,
            timeout,
            watchdog = "role-agent"
        });

        return new OperationTimedOutReply(
            pendingOperation.OperationKey,
            new CorrelationId($"corr-{pendingOperation.OperationId.Value}-timeout"),
            selfAddress,
            null,
            new OperationError(
                "operation_timeout",
                $"Operation '{pendingOperation.OperationKey.RequestId.Value}' timed out after {timeout}.",
                options.TimeoutRetryable,
                detailsJson));
    }
}