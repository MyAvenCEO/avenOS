using System.Text.Json;
using Akka.Actor;
using Akka.Persistence;
using Aven.ActorKernel;
using Aven.Contracts.Protocol.Envelopes;
using Aven.DurableDelivery;
using Aven.RoleAgents.Runtime;
using OperationCancelledReply = Aven.Contracts.Operations.OperationCancelled;
using OperationFailureReply = Aven.Contracts.Operations.OperationFailed;
using OperationRejectedReply = Aven.Contracts.Operations.OperationRejected;
using OperationTimedOutReply = Aven.Contracts.Operations.OperationTimedOut;
using LedgerOperationFailed = Aven.RoleAgents.Contracts.Ledger.OperationFailed;

namespace Aven.RoleAgents;

public sealed class RoleAgentActor : AvenPersistentActor, IWithTimers
{
    private const int MaxRecentClosedWorkItems = 256;
    private readonly RoleAgentId _agentId;
    private readonly IActorAddressResolver? _resolver;
    private readonly DurableDeliveryFactory? _deliveryLauncher;
    private readonly IReadOnlyDictionary<string, ActorAddress> _resourceGateways;
    private readonly ActorAddress _selfAddress;
    private readonly IRoleBehaviorHandler? _roleBehaviorHandler;
    private readonly IRoleAgentLedgerQuery? _ledgerQuery;
    private readonly string? _initialRunStateJson;
    private readonly RoleAgentOperationWatchdogOptions _operationWatchdogOptions;
    private readonly RoleAgentWorkInputFactory _workInputFactory;
    private RoleAgentState _state;
    private readonly HashSet<string> _dispatchedOperationIds = new(StringComparer.Ordinal);
    private readonly HashSet<WorkItemId> _recentClosedWorkItemIds = new();
    private readonly Queue<WorkItemId> _recentClosedWorkItemOrder = new();
    private readonly List<DeferredDeliveryAttemptOffer> _deferredDeliveryOffers = new();
    private bool _closedWorkCacheReady;
    private string? _closedWorkCacheLoadFailureMessage;

    private sealed record DispatchPendingWork;
    private sealed record OperationTimeoutDue(OperationId OperationId, DateTimeOffset Deadline);
    private sealed record ClosedWorkCacheLoaded(IReadOnlyList<WorkItemSnapshot> WorkItems);
    private sealed record ClosedWorkCacheLoadFailed(Exception Exception);
    private sealed record DeferredDeliveryAttemptOffer(DeliveryAttemptOffer Offer, IActorRef ReplyTo);
    private sealed record ClosedWorkLookupCompleted(PendingAcceptedDelivery Pending, bool Exists);
    private sealed record ClosedWorkLookupFailed(PendingAcceptedDelivery Pending, Exception Exception);
    private sealed record PendingAcceptedDelivery(
        DeliveryAttemptOffer Offer,
        IActorRef ReplyTo,
        AcceptedRoleWorkInput AcceptedInput,
        string DuplicateAcceptanceKind,
        string RecordedAcceptanceKind);
    public RoleAgentActor(
        string persistenceId,
        RoleAgentId agentId,
        RoleDescriptor roleProfile,
        string objective,
        IActorAddressResolver? resolver = null,
        IReadOnlyDictionary<string, ActorAddress>? resourceGateways = null,
        RoleAgentOperationWatchdogOptions? operationWatchdogOptions = null,
        IRoleAgentLedgerQuery? ledgerQuery = null,
        IRoleBehaviorHandler? roleBehaviorHandler = null)
    {
        PersistenceId = persistenceId;
        _agentId = agentId;
        _resolver = resolver;
        _deliveryLauncher = resolver is null ? null : new DurableDeliveryFactory(resolver);
        _resourceGateways = new Dictionary<string, ActorAddress>(resourceGateways ?? new Dictionary<string, ActorAddress>(), StringComparer.OrdinalIgnoreCase);
        _selfAddress = new ActorAddress($"agent/{_agentId.Value}", "local");
        _state = RoleAgentState.Create(agentId, roleProfile, objective);
        _roleBehaviorHandler = roleBehaviorHandler ?? BuiltInRoleBehaviorCatalog.GetHandler(roleProfile.RoleName);
        _ledgerQuery = ledgerQuery;
        _closedWorkCacheReady = ledgerQuery is null;
        _initialRunStateJson = _roleBehaviorHandler?.CreateInitialStateJson() ?? BuiltInRoleBehaviorCatalog.CreateInitialStateJson(roleProfile.RoleName);
        _operationWatchdogOptions = operationWatchdogOptions ?? RoleAgentOperationWatchdogOptions.ProductionDefault;
        _workInputFactory = new RoleAgentWorkInputFactory(agentId, roleProfile);

        Command<StartRoleAgent>(_ => HandleStart());
        Command<DeliveryAttemptOffer>(offer => HandleDeliveryAttemptOffer(offer, Sender));
        Command<DeliveryTerminalSignal>(HandleDeliveryTerminalSignal);
        Command<OperationResolved>(resolved => HandleOperationResolved(resolved, Sender));
        Command<OperationFailureReply>(failed => HandleOperationFailed(failed, Sender));
        Command<OperationRejectedReply>(rejected => HandleOperationRejected(rejected, Sender));
        Command<OperationTimedOutReply>(timedOut => HandleOperationTimedOut(timedOut, Sender));
        Command<OperationCancelledReply>(cancelled => HandleOperationCancelled(cancelled, Sender));
        Command<InspectRoleAgent>(_ => Sender.Tell(_state, Self));
        Command<DispatchPendingWork>(_ => DispatchPendingWorkInternal());
        Command<OperationTimeoutDue>(HandleOperationTimeoutDue);
        Command<ClosedWorkCacheLoaded>(HandleClosedWorkCacheLoaded);
        Command<ClosedWorkCacheLoadFailed>(HandleClosedWorkCacheLoadFailed);
        Command<ClosedWorkLookupCompleted>(HandleClosedWorkLookupCompleted);
        Command<ClosedWorkLookupFailed>(HandleClosedWorkLookupFailed);

        RecoverEvent<RoleAgentStarted>(ApplyAndRunSideEffects);
        RecoverEvent<WorkItemOpened>(ApplyAndRunSideEffects);
        RecoverEvent<RunStarted>(ApplyAndRunSideEffects);
        RecoverEvent<RunProgressed>(ApplyAndRunSideEffects);
        RecoverEvent<OperationRequested>(ApplyAndRunSideEffects);
        RecoverEvent<OperationCompleted>(ApplyAndRunSideEffects);
        RecoverEvent<LedgerOperationFailed>(ApplyAndRunSideEffects);
        RecoverEvent<RunCompleted>(ApplyAndRunSideEffects);
        RecoverEvent<RunBlocked>(ApplyAndRunSideEffects);
        RecoverEvent<RunFailed>(ApplyAndRunSideEffects);
        RecoverEvent<WorkItemClosed>(ApplyAndRunSideEffects);
        Recover<RecoveryCompleted>(_ =>
        {
            LoadClosedWorkCache();
            ScheduleOperationTimeoutsForPendingOperations();
            ScheduleDispatch();
        });
    }

    public override string PersistenceId { get; }
    public ITimerScheduler Timers { get; set; } = null!;

    private void HandleStart()
    {
        if (_state.Status != RoleAgentStatus.Created)
        {
            Sender.Tell(new StartRoleAgentAccepted(_agentId, _state.Status), Self);
            return;
        }

        var replyTo = Sender;
        var started = new RoleAgentStarted(
            _agentId,
            _state.RoleProfile.RoleName,
            _state.RoleProfile.DisplayName,
            _state.Objective,
            RoleAgentStatus.Running,
            _state.RoleMemoryJson);

        PersistEvent(
            started,
            MetadataFor<RoleAgentStarted>(
                _selfAddress,
                nameof(RoleAgentActor),
                ActorLocalCorrelationId(),
                started),
            e =>
            {
                ApplyAndRunSideEffects(e);
                replyTo.Tell(new StartRoleAgentAccepted(_agentId, _state.Status), Self);
            });
    }

    private void HandleDeliveryAttemptOffer(DeliveryAttemptOffer offer, IActorRef replyTo)
    {
        if (!_closedWorkCacheReady)
        {
            if (_closedWorkCacheLoadFailureMessage is not null)
            {
                RejectDelivery(replyTo, offer, "closed_work_cache_unavailable", _closedWorkCacheLoadFailureMessage, retryable: true);
                return;
            }

            _deferredDeliveryOffers.Add(new DeferredDeliveryAttemptOffer(offer, replyTo));
            return;
        }

        switch (offer.Envelope.MessageType)
        {
            case CommittedWorkItem.MessageType:
                HandleCommittedInputOffer(offer, replyTo);
                return;
            case ScheduledWorkTriggered.MessageType:
                HandleScheduledWorkTriggeredOffer(offer, replyTo);
                return;
            default:
                RejectDelivery(replyTo, offer, "unsupported_agent_delivery_message", $"Unsupported agent delivery message type '{offer.Envelope.MessageType}'.");
                return;
        }
    }

    private void HandleScheduledWorkTriggeredOffer(DeliveryAttemptOffer offer)
        => HandleScheduledWorkTriggeredOffer(offer, Sender);

    private void HandleScheduledWorkTriggeredOffer(DeliveryAttemptOffer offer, IActorRef replyTo)
    {
        var acceptedInput = _workInputFactory.TryCreateFromScheduledOffer(offer, out var rejection);
        if (acceptedInput is null)
        {
            RejectDelivery(replyTo, offer, rejection!);
            return;
        }

        var pending = new PendingAcceptedDelivery(
            offer,
            replyTo,
            acceptedInput!,
            "duplicate_scheduled_input",
            "scheduled_input_recorded");

        if (TryHandleKnownDuplicate(pending))
        {
            return;
        }

        if (BeginClosedWorkLookupIfNeeded(pending))
        {
            return;
        }

        StartAcceptedWorkItem(
            pending.AcceptedInput,
            replyTo,
            () => replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, pending.RecordedAcceptanceKind), Self),
            isAcceptedInput: true);
    }

    private void HandleCommittedInputOffer(DeliveryAttemptOffer offer)
        => HandleCommittedInputOffer(offer, Sender);

    private void HandleCommittedInputOffer(DeliveryAttemptOffer offer, IActorRef replyTo)
    {
        var acceptedInput = _workInputFactory.TryCreateFromCommittedOffer(offer, out var rejection);
        if (acceptedInput is null)
        {
            RejectDelivery(replyTo, offer, rejection!);
            return;
        }

        var pending = new PendingAcceptedDelivery(
            offer,
            replyTo,
            acceptedInput!,
            "duplicate_committed_input",
            "agent_input_recorded");

        if (TryHandleKnownDuplicate(pending))
        {
            return;
        }

        if (BeginClosedWorkLookupIfNeeded(pending))
        {
            return;
        }

        StartAcceptedWorkItem(
            pending.AcceptedInput,
            replyTo,
            () => replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, pending.RecordedAcceptanceKind), Self),
            isAcceptedInput: true);
    }

    private void HandleOperationResolved(OperationResolved resolved, IActorRef replyTo)
    {
        if (TryFindPendingOperation(resolved.Key, out var pendingOperation))
        {
            PersistOperationCompletionAndAdvance(pendingOperation, resolved, replyTo, !replyTo.IsNobody());
            return;
        }

        if (!replyTo.IsNobody())
        {
            replyTo.Tell(new RoleAgentIgnoredLateReply(_agentId, resolved.Key, "operation_not_pending"), Self);
        }
    }

    private void HandleOperationFailed(OperationFailureReply failed, IActorRef replyTo)
        => HandleTerminalOperationFailure(failed.Key, failed.CorrelationId, failed.Error.Message, failed.Error.Retryable, replyTo);

    private void HandleOperationRejected(OperationRejectedReply rejected, IActorRef replyTo)
        => HandleTerminalOperationFailure(rejected.Key, rejected.CorrelationId, rejected.Error.Message, rejected.Error.Retryable, replyTo);

    private void HandleOperationTimedOut(OperationTimedOutReply timedOut, IActorRef replyTo)
        => HandleTerminalOperationFailure(timedOut.Key, timedOut.CorrelationId, timedOut.Error.Message, timedOut.Error.Retryable, replyTo);

    private void HandleOperationCancelled(OperationCancelledReply cancelled, IActorRef replyTo)
        => HandleTerminalOperationFailure(cancelled.Key, cancelled.CorrelationId, "operation_cancelled", retryable: false, replyTo);

    private void HandleTerminalOperationFailure(
        OperationKey key,
        CorrelationId correlationId,
        string reason,
        bool retryable,
        IActorRef replyTo)
    {
        if (!TryFindPendingOperation(key, out var pendingOperation))
        {
            if (!replyTo.IsNobody())
            {
                replyTo.Tell(new RoleAgentIgnoredLateReply(_agentId, key, "operation_not_pending"), Self);
            }

            return;
        }

        PersistFailureAndTransition(pendingOperation, key, correlationId, reason, retryable, !replyTo.IsNobody(), replyTo);
    }

    private void HandleDeliveryTerminalSignal(DeliveryTerminalSignal signal)
    {
        if (!TryGetOperationId(signal.DeliveryId, out var operationId)
            || !_state.PendingOperations.TryGetValue(operationId, out var pendingOperation))
        {
            return;
        }

        if (signal.State.Status == DeliveryStatus.Accepted)
        {
            return;
        }

        var error = signal.State.TerminalError
            ?? new OperationError("operation_delivery_failed", $"Operation delivery ended with status {signal.State.Status}.", false);

        PersistFailureAndTransition(
            pendingOperation,
            pendingOperation.OperationKey,
            new CorrelationId($"corr-{operationId.Value}"),
            error.Message,
            error.Retryable,
            shouldReply: false,
            replyTo: ActorRefs.Nobody);
    }

    private void StartAcceptedWorkItem(
        AcceptedRoleWorkInput acceptedInput,
        IActorRef replyTo,
        Action? onAccepted,
        bool isAcceptedInput)
    {
        StartWorkItemAndRun(
            acceptedInput.WorkItemId,
            acceptedInput.Subject,
            acceptedInput.InputSummary,
            acceptedInput.InputArtifact,
            acceptedInput.Goal,
            acceptedInput.Resolved,
            acceptedInput.CorrelationId,
            replyTo,
            onAccepted,
            isAcceptedInput);
    }

    private void StartWorkItemAndRun(
        WorkItemId workItemId,
        string subject,
        string? inputSummary,
        ArtifactRef? inputArtifact,
        string goal,
        OperationResolved resolved,
        CorrelationId correlationId,
        IActorRef replyTo,
        Action? onAccepted,
        bool isAcceptedInput = false)
    {
        var runId = CreateRunId(workItemId);
        var openedAt = DateTimeOffset.UtcNow;

        PersistEvent(
            new WorkItemOpened(workItemId, _agentId, subject, inputSummary, inputArtifact, openedAt),
            MetadataFor<WorkItemOpened>(
                _selfAddress,
                nameof(RoleAgentActor),
                correlationId,
                new { workItemId = workItemId.Value, subject, inputSummary },
                operationKey: resolved.Key,
                occurredAt: openedAt),
            opened =>
            {
                ApplyAndRunSideEffects(opened);
                PersistEvent(
                    new RunStarted(runId, workItemId, _agentId, goal, openedAt),
                    MetadataFor<RunStarted>(
                        _selfAddress,
                        nameof(RoleAgentActor),
                        correlationId,
                        new { runId = runId.Value, workItemId = workItemId.Value, goal },
                        operationKey: resolved.Key,
                        occurredAt: openedAt),
                    started =>
                    {
                        ApplyAndRunSideEffects(started);
                        if (isAcceptedInput)
                        {
                            onAccepted?.Invoke();
                        }

                        ContinueRunAfterResolved(
                            runId,
                            workItemId,
                            resolved,
                            replyTo,
                            !replyTo.IsNobody(),
                            isAcceptedInput ? null : onAccepted,
                            isAcceptedInput);
                    });
            });
    }

    private void PersistOperationCompletionAndAdvance(PendingOperationState pendingOperation, OperationResolved resolved, IActorRef replyTo, bool shouldReply)
    {
        var completedAt = DateTimeOffset.UtcNow;
        var completed = new OperationCompleted(
            pendingOperation.OperationId,
            pendingOperation.RunId,
            pendingOperation.WorkItemId,
            _agentId,
            pendingOperation.OperationKey,
            pendingOperation.ContractId,
            resolved.Value.ValueJson,
            completedAt);

        PersistEvent(
            completed,
            MetadataFor<OperationCompleted>(
                _selfAddress,
                nameof(RoleAgentActor),
                resolved.CorrelationId,
                completed,
                operationKey: pendingOperation.OperationKey,
                occurredAt: completedAt),
            e =>
            {
                ApplyAndRunSideEffects(e);
                ContinueRunAfterResolved(pendingOperation.RunId, pendingOperation.WorkItemId, resolved, replyTo, shouldReply, onAccepted: null);
            });
    }

    private void ContinueRunAfterResolved(
        RunId runId,
        WorkItemId workItemId,
        OperationResolved resolved,
        IActorRef replyTo,
        bool shouldReply,
        Action? onAccepted,
        bool isAcceptedInput = false)
    {
        var runStateJson = _state.ActiveRuns.TryGetValue(workItemId, out var activeRun)
            ? activeRun.RunStateJson ?? _initialRunStateJson
            : _initialRunStateJson;
        var roleContext = new RoleBehaviorContext(_agentId, runStateJson, OutstandingRoleOperationsForRun(runId));

        if (_roleBehaviorHandler is null || (!isAcceptedInput && !_roleBehaviorHandler.CanHandle(resolved, roleContext)))
        {
            PersistBlockedRun(runId, workItemId, resolved.CorrelationId, resolved.Key, "role_behavior_cannot_handle_input", replyTo, shouldReply, onAccepted);
            return;
        }

        var roleResult = _roleBehaviorHandler.Apply(resolved, roleContext);
        PersistRoleResult(runId, workItemId, resolved, roleResult, replyTo, shouldReply, onAccepted);
    }

    private void PersistRoleResult(
        RunId runId,
        WorkItemId workItemId,
        OperationResolved resolved,
        RoleBehaviorResult roleResult,
        IActorRef replyTo,
        bool shouldReply,
        Action? onAccepted)
    {
        var progressedAt = DateTimeOffset.UtcNow;
        PersistEvent(
            new RunProgressed(runId, workItemId, _agentId, roleResult.RoleStateJson, resolved.CorrelationId, progressedAt),
            MetadataFor<RunProgressed>(
                _selfAddress,
                nameof(RoleAgentActor),
                resolved.CorrelationId,
                new { runId = runId.Value, workItemId = workItemId.Value, roleStateJson = roleResult.RoleStateJson, correlationId = resolved.CorrelationId.Value },
                operationKey: resolved.Key,
                occurredAt: progressedAt),
            progressed =>
            {
                ApplyAndRunSideEffects(progressed);
                PersistRequestedOperationsSequentially(runId, workItemId, roleResult.OperationsToRequest, 0, resolved.CorrelationId, resolved.Key, () => PersistRunTerminalTransition(runId, workItemId, roleResult, resolved.CorrelationId, resolved.Key, replyTo, shouldReply, onAccepted));
            });
    }

    private void PersistRequestedOperationsSequentially(
        RunId runId,
        WorkItemId workItemId,
        IReadOnlyList<RoleOperation> operations,
        int index,
        CorrelationId correlationId,
        OperationKey causationKey,
        Action onCompleted)
    {
        if (index >= operations.Count)
        {
            onCompleted();
            return;
        }

        var operation = operations[index];
        var operationKey = new OperationKey(_selfAddress, new RequestId(operation.RequestId), operation.TargetOperationType);
        var operationId = CreateOperationId(runId, operation.RequestId, operation.TargetOperationType);
        var requestedAt = DateTimeOffset.UtcNow;
        var requested = new OperationRequested(
            operationId,
            runId,
            workItemId,
            _agentId,
            operationKey,
            operation.ProviderKind,
            operation.TargetOperationType,
            operation.Payload.Json,
            requestedAt);

        PersistEvent(
            requested,
            MetadataFor<OperationRequested>(
                _selfAddress,
                nameof(RoleAgentActor),
                correlationId,
                requested,
                operationKey: operationKey,
                occurredAt: requestedAt),
            e =>
            {
                ApplyAndRunSideEffects(e);
                if (_state.PendingOperations.TryGetValue(e.OperationId, out var pendingOperation))
                {
                    ScheduleOperationTimeout(pendingOperation);
                }

                PersistRequestedOperationsSequentially(runId, workItemId, operations, index + 1, correlationId, causationKey, onCompleted);
            });
    }

    private void HandleOperationTimeoutDue(OperationTimeoutDue due)
    {
        if (!_state.PendingOperations.TryGetValue(due.OperationId, out var pendingOperation))
        {
            return;
        }

        var timeoutPlan = RoleAgentOperationWatchdogPlanner.TryPlan(pendingOperation, _operationWatchdogOptions, DateTimeOffset.UtcNow);
        if (timeoutPlan is null)
        {
            CancelOperationTimeout(due.OperationId);
            return;
        }

        if (DateTimeOffset.UtcNow < timeoutPlan.Deadline)
        {
            Timers.StartSingleTimer(OperationTimeoutTimerKey(due.OperationId), new OperationTimeoutDue(due.OperationId, timeoutPlan.Deadline), timeoutPlan.Delay);
            return;
        }

        var timedOut = RoleAgentOperationWatchdogPlanner.BuildTimeoutReply(pendingOperation, _operationWatchdogOptions, _selfAddress, timeoutPlan.Deadline);

        HandleOperationTimedOut(timedOut, ActorRefs.Nobody);
    }

    private void PersistRunTerminalTransition(
        RunId runId,
        WorkItemId workItemId,
        RoleBehaviorResult roleResult,
        CorrelationId correlationId,
        OperationKey processedKey,
        IActorRef replyTo,
        bool shouldReply,
        Action? onAccepted)
    {
        var hasPending = _state.PendingOperations.Values.Any(x => x.RunId == runId);
        if (roleResult.Status is RoleBehaviorStatus.Failed or RoleBehaviorStatus.Cancelled)
        {
            PersistFailedRun(runId, workItemId, correlationId, processedKey, roleResult.FinalResult ?? "run_failed", replyTo, shouldReply, onAccepted);
            return;
        }

        if (roleResult.Status == RoleBehaviorStatus.Blocked || (!hasPending && roleResult.Status is RoleBehaviorStatus.WaitingForOperation or RoleBehaviorStatus.WaitingForHuman))
        {
            PersistBlockedRun(runId, workItemId, correlationId, processedKey, roleResult.FinalResult ?? "waiting_for_additional_input", replyTo, shouldReply, onAccepted);
            return;
        }

        if (!hasPending && roleResult.Status == RoleBehaviorStatus.Idle)
        {
            var summary = roleResult.FinalResult ?? $"completed_{_state.RoleProfile.RoleName}";
            var completedAt = DateTimeOffset.UtcNow;
            var completed = new RunCompleted(runId, summary, roleResult.RoleStateJson ?? BuildRoleMemoryPatch(summary, workItemId, completedAt), completedAt);
            PersistEvent(
                completed,
                MetadataFor<RunCompleted>(
                    _selfAddress,
                    nameof(RoleAgentActor),
                    correlationId,
                    completed,
                    operationKey: processedKey,
                    occurredAt: completedAt),
                e =>
                {
                    ApplyAndRunSideEffects(e);
                    PersistEvent(
                        new WorkItemClosed(workItemId, summary, completedAt),
                        MetadataFor<WorkItemClosed>(
                            _selfAddress,
                            nameof(RoleAgentActor),
                            correlationId,
                            new { workItemId = workItemId.Value, outcome = summary },
                            operationKey: processedKey,
                            occurredAt: completedAt),
                        closed =>
                        {
                            ApplyAndRunSideEffects(closed);
                            FinalizeCommand(replyTo, shouldReply, onAccepted);
                        });
                });
            return;
        }

        FinalizeCommand(replyTo, shouldReply, onAccepted);
    }

    private void PersistBlockedRun(
        RunId runId,
        WorkItemId workItemId,
        CorrelationId correlationId,
        OperationKey operationKey,
        string reason,
        IActorRef replyTo,
        bool shouldReply,
        Action? onAccepted)
    {
        var blockedAt = DateTimeOffset.UtcNow;
        var blocked = new RunBlocked(runId, reason, blockedAt);
        PersistEvent(
            blocked,
            MetadataFor<RunBlocked>(
                _selfAddress,
                nameof(RoleAgentActor),
                correlationId,
                blocked,
                operationKey: operationKey,
                occurredAt: blockedAt),
            e =>
            {
                ApplyAndRunSideEffects(e);
                FinalizeCommand(replyTo, shouldReply, onAccepted);
            });
    }

    private void PersistFailedRun(
        RunId runId,
        WorkItemId workItemId,
        CorrelationId correlationId,
        OperationKey operationKey,
        string reason,
        IActorRef replyTo,
        bool shouldReply,
        Action? onAccepted)
    {
        var failedAt = DateTimeOffset.UtcNow;
        var failed = new RunFailed(runId, reason, failedAt);
        PersistEvent(
            failed,
            MetadataFor<RunFailed>(
                _selfAddress,
                nameof(RoleAgentActor),
                correlationId,
                failed,
                operationKey: operationKey,
                occurredAt: failedAt),
            e =>
            {
                ApplyAndRunSideEffects(e);
                FinalizeCommand(replyTo, shouldReply, onAccepted);
            });
    }

    private void PersistFailureAndTransition(
        PendingOperationState pendingOperation,
        OperationKey replyKey,
        CorrelationId correlationId,
        string reason,
        bool retryable,
        bool shouldReply,
        IActorRef replyTo)
    {
        var failedAt = DateTimeOffset.UtcNow;
        var failed = new LedgerOperationFailed(
            pendingOperation.OperationId,
            pendingOperation.RunId,
            pendingOperation.WorkItemId,
            _agentId,
            pendingOperation.OperationKey,
            pendingOperation.ContractId,
            reason,
            retryable,
            failedAt);

        PersistEvent(
            failed,
            MetadataFor<LedgerOperationFailed>(
                _selfAddress,
                nameof(RoleAgentActor),
                correlationId,
                failed,
                operationKey: pendingOperation.OperationKey,
                occurredAt: failedAt),
            e =>
            {
                ApplyAndRunSideEffects(e);
                PersistSiblingOperationFailuresThenRunTerminal(pendingOperation, replyKey, correlationId, reason, retryable, shouldReply, replyTo);
            });
    }

    private void PersistSiblingOperationFailuresThenRunTerminal(
        PendingOperationState triggeringOperation,
        OperationKey replyKey,
        CorrelationId correlationId,
        string terminalReason,
        bool retryable,
        bool shouldReply,
        IActorRef replyTo)
    {
        var siblings = _state.PendingOperations.Values
            .Where(x => x.RunId == triggeringOperation.RunId)
            .OrderBy(x => x.RequestedAt)
            .ToArray();

        PersistSiblingOperationFailuresSequentially(
            siblings,
            0,
            triggeringOperation.RunId,
            triggeringOperation.WorkItemId,
            correlationId,
            replyKey,
            terminalReason,
            retryable,
            shouldReply,
            replyTo);
    }

    private void PersistSiblingOperationFailuresSequentially(
        IReadOnlyList<PendingOperationState> siblings,
        int index,
        RunId runId,
        WorkItemId workItemId,
        CorrelationId correlationId,
        OperationKey replyKey,
        string terminalReason,
        bool retryable,
        bool shouldReply,
        IActorRef replyTo)
    {
        if (index >= siblings.Count)
        {
            if (retryable)
            {
                PersistBlockedRun(runId, workItemId, correlationId, replyKey, terminalReason, replyTo, shouldReply, onAccepted: null);
            }
            else
            {
                PersistFailedRun(runId, workItemId, correlationId, replyKey, terminalReason, replyTo, shouldReply, onAccepted: null);
            }

            return;
        }

        var sibling = siblings[index];
        var failedAt = DateTimeOffset.UtcNow;
        var failed = new LedgerOperationFailed(
            sibling.OperationId,
            sibling.RunId,
            sibling.WorkItemId,
            _agentId,
            sibling.OperationKey,
            sibling.ContractId,
            "run_terminated_after_operation_failure",
            false,
            failedAt);

        PersistEvent(
            failed,
            MetadataFor<LedgerOperationFailed>(
                _selfAddress,
                nameof(RoleAgentActor),
                correlationId,
                failed,
                operationKey: sibling.OperationKey,
                occurredAt: failedAt),
            e =>
            {
                ApplyAndRunSideEffects(e);
                PersistSiblingOperationFailuresSequentially(siblings, index + 1, runId, workItemId, correlationId, replyKey, terminalReason, retryable, shouldReply, replyTo);
            });
    }

    private void DispatchPendingWorkInternal()
    {
        if (_resolver is null || _resourceGateways.Count == 0 || _state.PendingOperations.Count == 0)
        {
            return;
        }

        var result = RoleAgentOperationDispatcher.DispatchPending(
            _state,
            _dispatchedOperationIds,
            _resourceGateways,
            _selfAddress,
            PersistenceId,
            _deliveryLauncher ?? throw new InvalidOperationException("Agent delivery launcher is unavailable."),
            Context,
            pendingOperation => _state.ActiveRuns.TryGetValue(pendingOperation.WorkItemId, out var activeRun)
                ? activeRun.CorrelationId
                : ActorLocalCorrelationId());

        foreach (var operationId in result.DispatchedOperationIds)
        {
            _dispatchedOperationIds.Add(operationId);
        }
    }

    private IReadOnlyList<RoleOperation> OutstandingRoleOperationsForRun(RunId runId) =>
        _state.PendingOperations.Values
            .Where(x => x.RunId == runId)
            .OrderBy(x => x.RequestedAt)
            .Select(x => new RoleOperation(
                x.TargetKind,
                x.OperationKey.RequestId.Value,
                _state.ActiveRuns.TryGetValue(x.WorkItemId, out var activeRun) ? activeRun.CorrelationId : ActorLocalCorrelationId(),
                x.ContractId,
                x.Input))
            .ToArray();

    private bool TryFindPendingOperation(OperationKey replyKey, out PendingOperationState pendingOperation)
    {
        var match = _state.PendingOperations.Values.FirstOrDefault(x => x.OperationKey == replyKey);
        pendingOperation = match!;
        return match is not null;
    }

    private void FinalizeCommand(IActorRef replyTo, bool shouldReply, Action? onAccepted)
    {
        ResetDispatchedOperations();
        ScheduleDispatch();
        onAccepted?.Invoke();
        if (shouldReply)
        {
            replyTo.Tell(_state, Self);
        }
    }

    private void ScheduleDispatch()
    {
        if (_state.PendingOperations.Count > 0)
        {
            Self.Tell(new DispatchPendingWork());
        }
    }

    private static string OperationTimeoutTimerKey(OperationId id) => $"operation-timeout-{id.Value}";

    private void ScheduleOperationTimeout(PendingOperationState operation)
    {
        var plan = RoleAgentOperationWatchdogPlanner.TryPlan(operation, _operationWatchdogOptions, DateTimeOffset.UtcNow);
        if (plan is null)
        {
            CancelOperationTimeout(operation.OperationId);
            return;
        }

        Timers.StartSingleTimer(OperationTimeoutTimerKey(operation.OperationId), new OperationTimeoutDue(operation.OperationId, plan.Deadline), plan.Delay);
    }

    private void CancelOperationTimeout(OperationId operationId)
        => Timers.Cancel(OperationTimeoutTimerKey(operationId));

    private void ScheduleOperationTimeoutsForPendingOperations()
    {
        foreach (var pendingOperation in _state.PendingOperations.Values)
        {
            ScheduleOperationTimeout(pendingOperation);
        }
    }

    private void ResetDispatchedOperations() => _dispatchedOperationIds.Clear();

    private void ApplyAndRunSideEffects(object evt)
    {
        var transition = RoleAgentStateReducer.Apply(_state, evt);
        _state = transition.State;

        if (evt is WorkItemClosed closed)
        {
            TrackClosedWorkItem(closed.WorkItemId);
        }

        foreach (var operationId in transition.OperationTimeoutsToCancel)
        {
            CancelOperationTimeout(operationId);
        }
    }

    private static WorkItemId CreateWorkItemId(string seed) => new($"work-{SanitizeSeed(seed)}");
    private static RunId CreateRunId(WorkItemId workItemId) => new($"run-{SanitizeSeed(workItemId.Value)}-1");
    private static OperationId CreateOperationId(RunId runId, string requestId, string operationType) => new($"op-{SanitizeSeed(runId.Value)}-{SanitizeSeed(requestId)}-{SanitizeSeed(operationType)}");

    private static bool TryGetOperationId(DeliveryId deliveryId, out OperationId operationId)
    {
        const string prefix = "delivery-";
        if (deliveryId.Value.StartsWith(prefix, StringComparison.Ordinal))
        {
            operationId = new OperationId(deliveryId.Value[prefix.Length..]);
            return true;
        }

        operationId = default;
        return false;
    }

    private bool HasOpenActiveOrClosedWork(WorkItemId workItemId) =>
        _state.OpenWorkItems.ContainsKey(workItemId)
        || _state.ActiveRuns.ContainsKey(workItemId)
        || _recentClosedWorkItemIds.Contains(workItemId);

    private bool TryHandleKnownDuplicate(PendingAcceptedDelivery pending)
    {
        if (!HasOpenActiveOrClosedWork(pending.AcceptedInput.WorkItemId))
        {
            return false;
        }

        pending.ReplyTo.Tell(
            new DeliveryAccepted(
                pending.Offer.DeliveryId,
                pending.Offer.Envelope.CommandId,
                pending.Offer.Envelope.Recipient,
                pending.DuplicateAcceptanceKind),
            Self);
        return true;
    }

    private bool BeginClosedWorkLookupIfNeeded(PendingAcceptedDelivery pending)
    {
        if (_ledgerQuery is null || _recentClosedWorkItemIds.Contains(pending.AcceptedInput.WorkItemId))
        {
            return false;
        }

        var self = Self;
        _ = CheckClosedWorkItemAsync(self, pending);
        return true;
    }

    private async Task CheckClosedWorkItemAsync(IActorRef self, PendingAcceptedDelivery pending)
    {
        try
        {
            var exists = await _ledgerQuery!.HasClosedWorkItemAsync(_agentId, pending.AcceptedInput.WorkItemId, CancellationToken.None);
            self.Tell(new ClosedWorkLookupCompleted(pending, exists), self);
        }
        catch (Exception ex)
        {
            self.Tell(new ClosedWorkLookupFailed(pending, ex), self);
        }
    }

    private void HandleClosedWorkLookupCompleted(ClosedWorkLookupCompleted completed)
    {
        if (completed.Exists)
        {
            TrackClosedWorkItem(completed.Pending.AcceptedInput.WorkItemId);
            completed.Pending.ReplyTo.Tell(
                new DeliveryAccepted(
                    completed.Pending.Offer.DeliveryId,
                    completed.Pending.Offer.Envelope.CommandId,
                    completed.Pending.Offer.Envelope.Recipient,
                    completed.Pending.DuplicateAcceptanceKind),
                Self);
            return;
        }

        if (TryHandleKnownDuplicate(completed.Pending))
        {
            return;
        }

        StartAcceptedWorkItem(
            completed.Pending.AcceptedInput,
            completed.Pending.ReplyTo,
            () => completed.Pending.ReplyTo.Tell(
                new DeliveryAccepted(
                    completed.Pending.Offer.DeliveryId,
                    completed.Pending.Offer.Envelope.CommandId,
                    completed.Pending.Offer.Envelope.Recipient,
                    completed.Pending.RecordedAcceptanceKind),
                Self),
            isAcceptedInput: true);
    }

    private void HandleClosedWorkLookupFailed(ClosedWorkLookupFailed failed)
        => RejectDelivery(
            failed.Pending.ReplyTo,
            failed.Pending.Offer,
            "closed_work_lookup_failed",
            $"Closed work lookup failed: {failed.Exception.Message}",
            retryable: true);

    private void LoadClosedWorkCache()
    {
        if (_ledgerQuery is null)
        {
            _closedWorkCacheReady = true;
            FlushDeferredDeliveryOffers();
            return;
        }

        var self = Self;
        _ = LoadClosedWorkCacheAsync(self);
    }

    private async Task LoadClosedWorkCacheAsync(IActorRef self)
    {
        try
        {
            var workItems = await (_ledgerQuery?.ListWorkItemsAsync(_agentId, WorkItemStatus.Closed, MaxRecentClosedWorkItems, CancellationToken.None)
                ?? Task.FromResult<IReadOnlyList<WorkItemSnapshot>>(Array.Empty<WorkItemSnapshot>()));
            self.Tell(new ClosedWorkCacheLoaded(workItems), self);
        }
        catch (Exception ex)
        {
            self.Tell(new ClosedWorkCacheLoadFailed(ex), self);
        }
    }

    private void HandleClosedWorkCacheLoaded(ClosedWorkCacheLoaded loaded)
    {
        _closedWorkCacheLoadFailureMessage = null;
        foreach (var workItem in loaded.WorkItems)
        {
            TrackClosedWorkItem(workItem.WorkItemId);
        }

        _closedWorkCacheReady = true;
        FlushDeferredDeliveryOffers();
    }

    private void HandleClosedWorkCacheLoadFailed(ClosedWorkCacheLoadFailed failed)
    {
        _closedWorkCacheReady = false;
        _closedWorkCacheLoadFailureMessage = $"Closed work cache load failed: {failed.Exception.Message}";
        RejectDeferredDeliveryOffersForCacheFailure(_closedWorkCacheLoadFailureMessage);
    }

    private void FlushDeferredDeliveryOffers()
    {
        if (_deferredDeliveryOffers.Count == 0)
        {
            return;
        }

        var deferred = _deferredDeliveryOffers.ToArray();
        _deferredDeliveryOffers.Clear();
        foreach (var pending in deferred)
        {
            HandleDeliveryAttemptOffer(pending.Offer, pending.ReplyTo);
        }
    }

    private void RejectDeferredDeliveryOffersForCacheFailure(string message)
    {
        if (_deferredDeliveryOffers.Count == 0)
        {
            return;
        }

        var deferred = _deferredDeliveryOffers.ToArray();
        _deferredDeliveryOffers.Clear();
        foreach (var pending in deferred)
        {
            RejectDelivery(pending.ReplyTo, pending.Offer, "closed_work_cache_unavailable", message, retryable: true);
        }
    }

    private void TrackClosedWorkItem(WorkItemId workItemId)
    {
        if (!_recentClosedWorkItemIds.Add(workItemId))
        {
            return;
        }

        _recentClosedWorkItemOrder.Enqueue(workItemId);
        while (_recentClosedWorkItemOrder.Count > MaxRecentClosedWorkItems)
        {
            _recentClosedWorkItemIds.Remove(_recentClosedWorkItemOrder.Dequeue());
        }
    }

    private void RejectDelivery(IActorRef replyTo, DeliveryAttemptOffer offer, string code, string message, bool retryable = false) =>
        RejectDelivery(replyTo, offer, new OperationError(code, message, retryable));

    private void RejectDelivery(IActorRef replyTo, DeliveryAttemptOffer offer, OperationError error)
        => replyTo.Tell(new DeliveryRejected(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, error), Self);

    private static string BuildRoleMemoryPatch(string summary, WorkItemId workItemId, DateTimeOffset completedAt) =>
        JsonSerializer.Serialize(new { lastRunSummary = summary, workItemId = workItemId.Value, updatedAt = completedAt });

    private static string SanitizeSeed(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var index = 0;
        foreach (var ch in value)
        {
            buffer[index++] = char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-';
        }

        return new string(buffer[..index]);
    }

    private void CancelOperationTimeoutsForRun(RunId runId)
    {
        foreach (var pendingOperation in _state.PendingOperations.Values.Where(x => x.RunId == runId).ToArray())
        {
            CancelOperationTimeout(pendingOperation.OperationId);
        }
    }

    private void CancelOperationTimeoutsForWorkItem(WorkItemId workItemId)
    {
        foreach (var pendingOperation in _state.PendingOperations.Values.Where(x => x.WorkItemId == workItemId).ToArray())
        {
            CancelOperationTimeout(pendingOperation.OperationId);
        }
    }
}
