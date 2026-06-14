using Akka.Actor;

namespace Aven.RoleAgents;

public sealed class RoleAgentLedgerProjectionActor : ReceiveActor
{
    private sealed record BeginBackfill;
    private sealed record BackfillCompleted;
    private sealed record BackfillFailed(Exception Exception);
    private sealed record LedgerApplyCompleted(IAvenEventEnvelope Envelope);
    private sealed record LedgerApplyFailed(Exception Exception);

    private readonly RoleAgentLedgerStore _store;
    private readonly RoleAgentLedgerProjectionOptions _options;
    private readonly Func<ActorSystem, RoleAgentLedgerStore, Task> _backfillAsync;
    private readonly Func<IAvenEventEnvelope, Task> _applyAsync;
    private readonly Queue<IAvenEventEnvelope> _bufferedLiveEvents = new();
    private readonly Queue<IAvenEventEnvelope> _pendingApplies = new();
    private bool _backfillInProgress;
    private bool _applyInProgress;

    public RoleAgentLedgerProjectionActor(
        RoleAgentLedgerStore store,
        RoleAgentLedgerProjectionOptions? options = null,
        Func<ActorSystem, RoleAgentLedgerStore, Task>? backfillAsync = null,
        Func<IAvenEventEnvelope, Task>? applyAsync = null)
    {
        _store = store;
        _options = options ?? new RoleAgentLedgerProjectionOptions();
        var backfillReader = new RoleAgentLedgerBackfillReader();
        _backfillAsync = backfillAsync ?? ((system, ledgerStore) => backfillReader.ReplayAsync(system, ledgerStore));
        _applyAsync = applyAsync ?? (envelope => _store.ApplyAsync(envelope));

        Receive<BeginBackfill>(_ => StartBackfill());
        Receive<BackfillCompleted>(_ => CompleteBackfill());
        Receive<BackfillFailed>(failed => throw failed.Exception);
        Receive<LedgerApplyCompleted>(_ =>
        {
            _applyInProgress = false;
            StartNextApply();
        });
        Receive<LedgerApplyFailed>(failed => throw failed.Exception);
        Receive<GetRoleAgentLedgerProjectionHealth>(_ =>
            Sender.Tell(new RoleAgentLedgerProjectionHealth(
                Idle: !_backfillInProgress && !_applyInProgress && _bufferedLiveEvents.Count == 0 && _pendingApplies.Count == 0,
                BackfillInProgress: _backfillInProgress,
                ApplyInProgress: _applyInProgress,
                BufferedLiveEvents: _bufferedLiveEvents.Count,
                PendingApplies: _pendingApplies.Count)));
        Receive<IAvenEventEnvelope>(HandleEnvelope);
    }

    protected override void PreStart()
    {
        Context.System.EventStream.Subscribe(Self, typeof(IAvenEventEnvelope));
        StartBackfill();
    }

    protected override void PostStop() => Context.System.EventStream.Unsubscribe(Self);

    private void StartBackfill()
    {
        if (_backfillInProgress)
        {
            return;
        }

        _backfillInProgress = true;
        var self = Self;
        _ = _backfillAsync(Context.System, _store)
            .ContinueWith(
                task => task.Exception is null
                    ? (object)new BackfillCompleted()
                    : new BackfillFailed(task.Exception.GetBaseException()),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(task.Result), TaskScheduler.Default);
    }

    private void CompleteBackfill()
    {
        _backfillInProgress = false;
        while (_bufferedLiveEvents.Count > 0)
        {
            EnqueuePendingApply(_bufferedLiveEvents.Dequeue());
        }
        StartNextApply();
    }

    private void HandleEnvelope(IAvenEventEnvelope envelope)
    {
        if (!IsLedgerEvent(envelope.Data))
        {
            return;
        }

        if (_backfillInProgress)
        {
            if (_bufferedLiveEvents.Count >= _options.MaxBufferedLiveEventsDuringBackfill)
            {
                throw new RoleAgentLedgerProjectionBufferOverflowException("role_agent_ledger_projection_backfill_live_buffer_overflow");
            }

            _bufferedLiveEvents.Enqueue(envelope);
            return;
        }

        EnqueuePendingApply(envelope);
        StartNextApply();
    }

    private void EnqueuePendingApply(IAvenEventEnvelope envelope)
    {
        if (_pendingApplies.Count >= _options.MaxPendingApplies)
        {
            throw new RoleAgentLedgerProjectionBufferOverflowException("role_agent_ledger_projection_pending_apply_overflow");
        }

        _pendingApplies.Enqueue(envelope);
    }

    private void StartNextApply()
    {
        if (_backfillInProgress || _applyInProgress || _pendingApplies.Count == 0)
        {
            return;
        }

        var envelope = _pendingApplies.Dequeue();
        _applyInProgress = true;
        var self = Self;
        _ = _applyAsync(envelope)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new LedgerApplyCompleted(envelope)
                    : new LedgerApplyFailed(task.Exception?.GetBaseException() ?? new InvalidOperationException("Ledger apply failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(task.Result), TaskScheduler.Default);
    }

    private static bool IsLedgerEvent(IAvenEvent e) => e is
        WorkItemOpened or
        RunStarted or
        RunProgressed or
        OperationRequested or
        OperationCompleted or
        Aven.RoleAgents.Contracts.Ledger.OperationFailed or
        RunCompleted or
        RunBlocked or
        RunFailed or
        WorkItemClosed;
}
