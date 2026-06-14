namespace Aven.RoleAgents.Runtime;

internal static class RoleAgentStateReducer
{
    public static RoleAgentStateTransition Apply(RoleAgentState state, object evt)
        => evt switch
        {
            RoleAgentStarted started => RoleAgentStateTransition.None(state with
            {
                Status = started.InitialStatus,
                RoleMemoryJson = started.RoleMemoryJson
            }),
            WorkItemOpened opened => ApplyWorkItemOpened(state, opened),
            RunStarted started => ApplyRunStarted(state, started),
            RunProgressed progressed => ApplyRunProgressed(state, progressed),
            OperationRequested requested => ApplyOperationRequested(state, requested),
            OperationCompleted completed => ApplyOperationCompleted(state, completed),
            Aven.RoleAgents.Contracts.Ledger.OperationFailed failed => ApplyOperationFailed(state, failed),
            RunCompleted completed => ApplyRunCompleted(state, completed),
            RunBlocked blocked => ApplyRunBlocked(state, blocked),
            RunFailed failed => ApplyRunFailed(state, failed),
            WorkItemClosed closed => ApplyWorkItemClosed(state, closed),
            _ => RoleAgentStateTransition.None(state)
        };

    private static RoleAgentStateTransition ApplyWorkItemOpened(RoleAgentState state, WorkItemOpened opened)
    {
        var openItems = state.OpenWorkItems.ToDictionary(static x => x.Key, static x => x.Value);
        openItems[opened.WorkItemId] = new OpenWorkItemState(opened.WorkItemId, opened.Subject, opened.InputSummary, opened.InputArtifact, opened.OpenedAt);
        return RoleAgentStateTransition.None(state with
        {
            OpenWorkItems = openItems,
            Status = state.Status == RoleAgentStatus.Created ? RoleAgentStatus.Running : state.Status
        });
    }

    private static RoleAgentStateTransition ApplyRunStarted(RoleAgentState state, RunStarted started)
    {
        var activeRuns = state.ActiveRuns.ToDictionary(static x => x.Key, static x => x.Value);
        activeRuns[started.WorkItemId] = new ActiveRunState(
            started.RunId,
            started.WorkItemId,
            started.Goal,
            started.StartedAt,
            state.RoleMemoryJson,
            default);
        return RoleAgentStateTransition.None(state with { ActiveRuns = activeRuns, Status = RoleAgentStatus.Running });
    }

    private static RoleAgentStateTransition ApplyRunProgressed(RoleAgentState state, RunProgressed progressed)
    {
        if (!state.ActiveRuns.TryGetValue(progressed.WorkItemId, out var activeRun))
        {
            return RoleAgentStateTransition.None(state);
        }

        var activeRuns = state.ActiveRuns.ToDictionary(static x => x.Key, static x => x.Value);
        activeRuns[progressed.WorkItemId] = activeRun with { RunStateJson = progressed.RunStateJson, CorrelationId = progressed.CorrelationId };
        return RoleAgentStateTransition.None(state with { ActiveRuns = activeRuns });
    }

    private static RoleAgentStateTransition ApplyOperationRequested(RoleAgentState state, OperationRequested requested)
    {
        var pending = state.PendingOperations.ToDictionary(static x => x.Key, static x => x.Value);
        pending[requested.OperationId] = new PendingOperationState(
            requested.OperationId,
            requested.RunId,
            requested.WorkItemId,
            requested.OperationKey,
            requested.TargetKind,
            requested.ContractId,
            PersistedCommandPayload.FromInlineJson(requested.InputJson),
            requested.RequestedAt);
        return RoleAgentStateTransition.None(state with
        {
            PendingOperations = pending,
            Status = string.Equals(requested.TargetKind, ResourceKinds.Human, StringComparison.OrdinalIgnoreCase)
                ? RoleAgentStatus.WaitingForHuman
                : RoleAgentStatus.WaitingForOperation
        });
    }

    private static RoleAgentStateTransition ApplyOperationCompleted(RoleAgentState state, OperationCompleted completed)
    {
        var pending = state.PendingOperations.ToDictionary(static x => x.Key, static x => x.Value);
        pending.Remove(completed.OperationId);
        var next = state with { PendingOperations = pending };
        return new RoleAgentStateTransition(next with { Status = ComputeStatusAfterPendingChange(next) }, [completed.OperationId]);
    }

    private static RoleAgentStateTransition ApplyOperationFailed(RoleAgentState state, Aven.RoleAgents.Contracts.Ledger.OperationFailed failed)
    {
        var pending = state.PendingOperations.ToDictionary(static x => x.Key, static x => x.Value);
        pending.Remove(failed.OperationId);
        return new RoleAgentStateTransition(state with { PendingOperations = pending }, [failed.OperationId]);
    }

    private static RoleAgentStateTransition ApplyRunCompleted(RoleAgentState state, RunCompleted completed)
    {
        var workItemId = FindWorkItemIdForRun(state, completed.RunId);
        if (workItemId is null)
        {
            return RoleAgentStateTransition.None(state);
        }

        var cancelIds = PendingOperationIdsForRun(state, completed.RunId);
        var activeRuns = state.ActiveRuns.ToDictionary(static x => x.Key, static x => x.Value);
        activeRuns.Remove(workItemId.Value);
        var next = RemovePendingOperationsForRun(state, completed.RunId) with
        {
            ActiveRuns = activeRuns,
            RoleMemoryJson = ApplyRoleMemoryPatch(state.RoleMemoryJson, completed.RoleMemoryPatchJson),
            LastRunSummary = completed.Summary
        };
        return new RoleAgentStateTransition(next with { Status = ComputeStatusAfterPendingChange(next) }, cancelIds);
    }

    private static RoleAgentStateTransition ApplyRunBlocked(RoleAgentState state, RunBlocked blocked)
    {
        var workItemId = FindWorkItemIdForRun(state, blocked.RunId);
        if (workItemId is null)
        {
            return RoleAgentStateTransition.None(state);
        }

        var cancelIds = PendingOperationIdsForRun(state, blocked.RunId);
        var activeRuns = state.ActiveRuns.ToDictionary(static x => x.Key, static x => x.Value);
        activeRuns.Remove(workItemId.Value);
        return new RoleAgentStateTransition(
            RemovePendingOperationsForRun(state, blocked.RunId) with
            {
                ActiveRuns = activeRuns,
                LastRunSummary = blocked.Reason,
                Status = RoleAgentStatus.Blocked
            },
            cancelIds);
    }

    private static RoleAgentStateTransition ApplyRunFailed(RoleAgentState state, RunFailed failed)
    {
        var workItemId = FindWorkItemIdForRun(state, failed.RunId);
        if (workItemId is null)
        {
            return RoleAgentStateTransition.None(state);
        }

        var cancelIds = PendingOperationIdsForRun(state, failed.RunId);
        var activeRuns = state.ActiveRuns.ToDictionary(static x => x.Key, static x => x.Value);
        activeRuns.Remove(workItemId.Value);
        return new RoleAgentStateTransition(
            RemovePendingOperationsForRun(state, failed.RunId) with
            {
                ActiveRuns = activeRuns,
                LastRunSummary = failed.Reason,
                Status = RoleAgentStatus.Failed
            },
            cancelIds);
    }

    private static RoleAgentStateTransition ApplyWorkItemClosed(RoleAgentState state, WorkItemClosed closed)
    {
        var cancelIds = state.PendingOperations.Values
            .Where(x => x.WorkItemId == closed.WorkItemId)
            .Select(x => x.OperationId)
            .ToArray();
        var openItems = state.OpenWorkItems.ToDictionary(static x => x.Key, static x => x.Value);
        openItems.Remove(closed.WorkItemId);
        var pending = state.PendingOperations
            .Where(x => x.Value.WorkItemId != closed.WorkItemId)
            .ToDictionary(static x => x.Key, static x => x.Value);
        var next = state with { OpenWorkItems = openItems, PendingOperations = pending };
        return new RoleAgentStateTransition(next with { Status = ComputeStatusAfterPendingChange(next) }, cancelIds);
    }

    private static RoleAgentState RemovePendingOperationsForRun(RoleAgentState state, RunId runId)
    {
        var pending = state.PendingOperations
            .Where(x => x.Value.RunId != runId)
            .ToDictionary(static x => x.Key, static x => x.Value);
        return state with { PendingOperations = pending };
    }

    private static WorkItemId? FindWorkItemIdForRun(RoleAgentState state, RunId runId)
        => state.ActiveRuns.FirstOrDefault(x => x.Value.RunId == runId).Key;

    private static IReadOnlyList<OperationId> PendingOperationIdsForRun(RoleAgentState state, RunId runId)
        => state.PendingOperations.Values.Where(x => x.RunId == runId).Select(x => x.OperationId).ToArray();

    private static RoleAgentStatus ComputeStatusAfterPendingChange(RoleAgentState state)
    {
        if (state.PendingOperations.Values.Any(x => string.Equals(x.TargetKind, ResourceKinds.Human, StringComparison.OrdinalIgnoreCase)))
        {
            return RoleAgentStatus.WaitingForHuman;
        }

        if (state.PendingOperations.Count > 0)
        {
            return RoleAgentStatus.WaitingForOperation;
        }

        if (state.ActiveRuns.Count > 0)
        {
            return RoleAgentStatus.Running;
        }

        return state.Status == RoleAgentStatus.Created ? RoleAgentStatus.Created : RoleAgentStatus.Idle;
    }

    private static string? ApplyRoleMemoryPatch(string? currentRoleMemoryJson, string? patchJson) =>
        string.IsNullOrWhiteSpace(patchJson) ? currentRoleMemoryJson : patchJson;
}