using Akka.Actor;
using Akka.Event;

namespace Aven.Trace.Actors;

public sealed class TraceProjectionActor : ReceiveActor, IWithTimers
{
    private const string FlushTimerKey = "trace-flush";
    private const string BufferOverflowReason = "trace_projection_buffer_overflow";
    private const string ManualFlushWaiterOverflowReason = "trace_projection_manual_flush_waiter_limit_exceeded";

    private readonly TraceStore _store;
    private readonly TraceEventMapper _mapper;
    private readonly TraceProjectionOptions _options;
    private readonly List<TraceProjectionDelta> _buffer = new();
    private readonly List<IActorRef> _manualFlushWaiters = new();
    private long _eventsSeen;
    private long _eventsWritten;
    private long _eventsDropped;
    private int _failureCount;
    private int _manualFlushesRejected;
    private string? _lastError;
    private bool _flushScheduled;
    private bool _flushInProgress;
    private TraceProjectionFlushed _pendingManualResult = new(0, 0, 0);

    public ITimerScheduler Timers { get; set; } = null!;

    public TraceProjectionActor(TraceStore store, TraceEventMapper? mapper, int batchSize, TimeSpan? flushInterval)
        : this(store, mapper, new TraceProjectionOptions(batchSize, flushInterval))
    {
    }

    public TraceProjectionActor(TraceStore store, TraceEventMapper? mapper = null, TraceProjectionOptions? options = null)
    {
        _store = store;
        _mapper = mapper ?? new TraceEventMapper();
        _options = options ?? new TraceProjectionOptions();

        Receive<IAvenEventEnvelope>(HandleEnvelope);
        Receive<FlushTraceProjection>(_ => HandleManualFlush(Sender));
        Receive<GetTraceProjectionHealth>(_ =>
            Sender.Tell(new TraceProjectionHealth(
                Healthy: _failureCount == 0 && _eventsDropped == 0,
                EventsSeen: _eventsSeen,
                EventsWritten: _eventsWritten,
                FailureCount: _failureCount,
                LastError: _lastError,
                BufferedEvents: _buffer.Count,
                FlushInProgress: _flushInProgress,
                EventsDropped: _eventsDropped,
                ManualFlushesRejected: _manualFlushesRejected)));
        Receive<FlushTick>(_ => RequestFlush());
        Receive<InternalFlushTraceProjection>(_ => StartFlushIfNeeded());
        Receive<TraceProjectionWriteCompleted>(HandleWriteCompleted);
        Timers.StartPeriodicTimer(FlushTimerKey, new FlushTick(), _options.FlushInterval ?? TimeSpan.FromMilliseconds(250));
    }

    protected override void PreStart() => Context.System.EventStream.Subscribe(Self, typeof(IAvenEventEnvelope));
    protected override void PostStop() => Context.System.EventStream.Unsubscribe(Self);

    private void HandleEnvelope(IAvenEventEnvelope envelope)
    {
        _eventsSeen++;
        try
        {
            if (_buffer.Count >= _options.MaxBufferedEvents)
            {
                _eventsDropped++;
                _lastError = BufferOverflowReason;
                return;
            }

            _buffer.Add(_mapper.Map(envelope));
            if (_buffer.Count >= Math.Max(1, _options.BatchSize))
            {
                RequestFlush();
            }
        }
        catch (Exception ex)
        {
            _failureCount++;
            _lastError = ex.Message;
            Context.GetLogger().Error(ex, "Trace event mapping failed for {0}", envelope.Meta.EventId);
        }
    }

    private void HandleManualFlush(IActorRef replyTo)
    {
        if (_buffer.Count == 0 && !_flushInProgress)
        {
            replyTo.Tell(new TraceProjectionFlushed(0, 0, 0));
            return;
        }

        if (_manualFlushWaiters.Count >= _options.MaxManualFlushWaiters)
        {
            _manualFlushesRejected++;
            replyTo.Tell(new Status.Failure(new InvalidOperationException(ManualFlushWaiterOverflowReason)));
            return;
        }

        if (_manualFlushWaiters.Count == 0)
        {
            _pendingManualResult = new TraceProjectionFlushed(0, 0, 0);
        }

        _manualFlushWaiters.Add(replyTo);
        RequestFlush();
    }

    private void RequestFlush()
    {
        if (_flushScheduled || _flushInProgress)
        {
            return;
        }

        _flushScheduled = true;
        Self.Tell(new InternalFlushTraceProjection());
    }

    private void StartFlushIfNeeded()
    {
        _flushScheduled = false;
        if (_flushInProgress || _buffer.Count == 0)
        {
            CompleteManualFlushesIfIdle();
            return;
        }

        var batch = _buffer.ToArray();
        _buffer.Clear();
        _flushInProgress = true;
        var self = Self;
        _store.WriteBatchAsync(batch)
            .ContinueWith(task =>
            {
                if (task.IsCompletedSuccessfully)
                {
                    self.Tell(new TraceProjectionWriteCompleted(batch, task.Result, null));
                }
                else
                {
                    self.Tell(new TraceProjectionWriteCompleted(batch, new TraceStoreWriteResult(0, 0, 0), task.Exception?.GetBaseException() ?? new InvalidOperationException("Trace projection write failed.")));
                }
            }, TaskScheduler.Default);
    }

    private void HandleWriteCompleted(TraceProjectionWriteCompleted completed)
    {
        _flushInProgress = false;
        if (completed.Error is null)
        {
            var result = completed.Result;
            _eventsWritten += result.EventsWritten;
            if (_manualFlushWaiters.Count > 0)
            {
                _pendingManualResult = new TraceProjectionFlushed(
                    _pendingManualResult.EventsWritten + result.EventsWritten,
                    _pendingManualResult.EntitiesWritten + result.EntitiesWritten,
                    _pendingManualResult.LinksWritten + result.LinksWritten);
            }
        }
        else
        {
            _failureCount++;
            _lastError = completed.Error.Message;
            _buffer.InsertRange(0, completed.Batch);
            Context.GetLogger().Error(completed.Error, "Trace projection flush failed for {0} events", completed.Batch.Length);
        }

        if (_buffer.Count > 0)
        {
            RequestFlush();
            return;
        }

        CompleteManualFlushesIfIdle();
    }

    private void CompleteManualFlushesIfIdle()
    {
        if (_flushInProgress || _buffer.Count > 0 || _manualFlushWaiters.Count == 0)
        {
            return;
        }

        var result = _pendingManualResult;
        _pendingManualResult = new TraceProjectionFlushed(0, 0, 0);
        foreach (var waiter in _manualFlushWaiters.ToArray())
        {
            waiter.Tell(result);
        }

        _manualFlushWaiters.Clear();
    }

    private sealed record FlushTick;
}
