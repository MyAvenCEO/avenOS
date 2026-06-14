using Akka.Actor;
using Akka.TestKit.Xunit2;
using Aven.Trace;

namespace Aven.Tests.Trace;

public sealed record TestTraceEvent(CommandId CommandId, DeliveryId DeliveryId, RoleAgentId RoleAgentId, string ApiKey, string LargeText) : IAvenEvent;
public sealed record TestLlmTraceEvent(LlmRequestId LlmRequestId, OperationKey Key, string Provider) : IAvenEvent;
public sealed record TestOperationKeyOnlyEvent(string Key, string Name) : IAvenEvent;

public sealed class TraceMapperStoreTests
{
    [Fact]
    public void TraceEventMapper_MapsMetadata_ExtractsScalarIds_RedactsAndTruncates()
    {
        var mapper = new TraceEventMapper(maxDetailsBytes: 256);
        var envelope = Envelope("evt-map", new TestTraceEvent(new CommandId("cmd-1"), new DeliveryId("del-1"), new RoleAgentId("agent-1"), "secret-value", new string('x', 1000)));

        var delta = mapper.Map(envelope);

        Assert.Equal("evt-map", delta.Event.EventId);
        Assert.Equal("corr-1", delta.Event.CorrelationId);
        Assert.Equal("cmd-1", delta.Event.CommandId);
        Assert.Equal("del-1", delta.Event.DeliveryId);
        Assert.True(delta.Event.DetailsTruncated);
        Assert.DoesNotContain("secret-value", delta.Event.DetailsJson, StringComparison.Ordinal);
        Assert.Contains(delta.Entities, x => x.EntityType == "agent" && x.EntityId == "agent-1");
        Assert.Contains(delta.Entities, x => x.EntityType == "delivery" && x.EntityId == "del-1");
    }

    [Fact]
    public async Task TraceStore_IgnoresDuplicateEventIds_AndReturnsOrderedTimeline()
    {
        var store = NewStore();
        var mapper = new TraceEventMapper();
        var first = mapper.Map(Envelope("evt-1", new TestTraceEvent(new CommandId("cmd-1"), new DeliveryId("del-1"), new RoleAgentId("agent-1"), "none", "one"), DateTimeOffset.UtcNow.AddSeconds(-2)));
        var second = mapper.Map(Envelope("evt-2", new TestTraceEvent(new CommandId("cmd-1"), new DeliveryId("del-1"), new RoleAgentId("agent-1"), "none", "two"), DateTimeOffset.UtcNow.AddSeconds(-1)));

        var result = await store.WriteBatchAsync([first, first, second]);
        var query = new TraceQueryService(store);
        var timeline = await query.GetCorrelationTimelineAsync("corr-1", new TraceQueryOptions(), CancellationToken.None);

        Assert.Equal(2, result.EventsWritten);
        Assert.Equal(new[] { "evt-1", "evt-2" }, timeline.Items.Select(x => x.EventId).ToArray());
    }

    [Fact]
    public async Task TraceInvariantChecker_DetectsPendingDelivery_AndIgnoresCompletedDelivery()
    {
        var store = NewStore();
        var old = DateTimeOffset.UtcNow.AddMinutes(-5);
        var pending = new TraceProjectionDelta(
            Event("evt-pending", "DeliveryInitialized", "del-pending", old),
            [new TraceEntityRecord("delivery", "del-pending", "pending", "pending", "evt-pending", old, "{}")], []);
        var accepted = new TraceProjectionDelta(
            Event("evt-accepted", "DeliveryAcceptedByRecipient", "del-ok", old),
            [new TraceEntityRecord("delivery", "del-ok", "accepted", "accepted", "evt-accepted", old, "{}")], []);
        await store.WriteBatchAsync([pending, accepted]);

        var stuck = await new TraceInvariantChecker(store, TimeSpan.FromSeconds(1)).GetStuckAsync(new TraceStuckQueryOptions(), CancellationToken.None);

        Assert.Contains(stuck, x => x.InvariantId.StartsWith("INV-001") && x.EntityId == "del-pending");
        Assert.DoesNotContain(stuck, x => x.EntityId == "del-ok");
    }

    [Fact]
    public void TraceEventMapper_MapsExpiredAndQuarantinedDeliveriesToDistinctTerminalStatuses()
    {
        var mapper = new TraceEventMapper();

        var expired = mapper.Map(EventEnvelope("evt-delivery-expired", "DeliveryExpired", new TestTraceEvent(new CommandId("cmd-exp"), new DeliveryId("del-exp"), new RoleAgentId("agent-exp"), "none", "expired")));
        var quarantined = mapper.Map(EventEnvelope("evt-delivery-quarantined", "DeliveryQuarantined", new TestTraceEvent(new CommandId("cmd-quar"), new DeliveryId("del-quar"), new RoleAgentId("agent-quar"), "none", "quarantined")));

        Assert.Contains(expired.Entities, x => x.EntityType == "delivery" && x.EntityId == "del-exp" && x.Status == "expired");
        Assert.Contains(quarantined.Entities, x => x.EntityType == "delivery" && x.EntityId == "del-quar" && x.Status == "quarantined");
    }

    [Fact]
    public async Task TraceEventMapper_MapsLlmRequestId_AndOperationSeparately()
    {
        var store = NewStore();
        var query = new TraceQueryService(store);
        var mapper = new TraceEventMapper();
        var llmRequestId = new LlmRequestId("llm-request-1");
        var operationKey = new OperationKey(new ActorAddress("agent/research", "local"), new RequestId("research-digest-1"), "llm.generate");
        var envelope = new AvenEventEnvelope<TestLlmTraceEvent>(
            new EventMetadata("evt-llm-1", nameof(TestLlmTraceEvent), 1, new ActorAddress("llm/worker", "local"), "LlmRequestWorkerActor", null, null, operationKey, new CorrelationId("corr-llm-1"), null, "hash", DateTimeOffset.UtcNow),
            new TestLlmTraceEvent(llmRequestId, operationKey, "openai"));

        await store.WriteBatchAsync([mapper.Map(envelope)]);

        var llmDetail = await query.GetLlmRequestAsync(llmRequestId.Value, CancellationToken.None);

        Assert.NotNull(llmDetail);
        Assert.Equal("llm_request", llmDetail!.Subject.Type);
        Assert.Equal(llmRequestId.Value, llmDetail.Subject.Id);
        Assert.Contains(llmDetail.Timeline.Links, x =>
            x.From.Type == "operation"
            && x.From.Id == "agent/research/research-digest-1/llm.generate"
            && x.To.Type == "llm_request"
            && x.To.Id == llmRequestId.Value
            && x.Type == "requested_llm");
    }

    [Fact]
    public async Task TraceEventMapper_DoesNotCreateLlmRequestEntity_ForNonLlmKeyProperty()
    {
        var store = NewStore();
        var mapper = new TraceEventMapper();
        var envelope = new AvenEventEnvelope<TestOperationKeyOnlyEvent>(
            new EventMetadata("evt-op-key", nameof(TestOperationKeyOnlyEvent), 1, new ActorAddress("test/actor", "local"), "TestActor", null, null, null, new CorrelationId("corr-op-key"), null, "hash", DateTimeOffset.UtcNow),
            new TestOperationKeyOnlyEvent("custom-operation-key", "demo"));

        await store.WriteBatchAsync([mapper.Map(envelope)]);

        var llmEntity = await store.GetEntityAsync("llm_request", "custom-operation-key", CancellationToken.None);
        var operationEntity = await store.GetEntityAsync("operation", "custom-operation-key", CancellationToken.None);

        Assert.Null(llmEntity);
        Assert.NotNull(operationEntity);
    }

    [Fact]
    public async Task TraceQueryService_GetDeliveryAsync_ReturnsEntityDetails_AndTimeline()
    {
        var store = NewStore();
        var mapper = new TraceEventMapper();
        await store.WriteBatchAsync([
            mapper.Map(Envelope(
                "evt-delivery-detail",
                new TestTraceEvent(
                    new CommandId("cmd-1"),
                    new DeliveryId("del-1"),
                    new RoleAgentId("agent-1"),
                    "secret-value",
                    "small")))
        ]);

        var query = new TraceQueryService(store);
        var detail = await query.GetDeliveryAsync("del-1", CancellationToken.None);

        Assert.NotNull(detail);
        Assert.Equal("delivery", detail!.Subject.Type);
        Assert.Equal("del-1", detail.Subject.Id);
        Assert.Equal("pending", detail.Status);
        Assert.NotNull(detail.Details);
        Assert.Contains("[REDACTED]", detail.Details!.ToJsonString(), StringComparison.Ordinal);
        Assert.Single(detail.Timeline.Items);
        Assert.Equal("del-1", detail.Timeline.Items[0].DeliveryId);
    }

    [Fact]
    public async Task TraceQueryService_CorrelationTimeline_CanExcludeEventDetails()
    {
        var store = NewStore();
        var mapper = new TraceEventMapper();
        await store.WriteBatchAsync([
            mapper.Map(Envelope(
                "evt-no-details",
                new TestTraceEvent(
                    new CommandId("cmd-1"),
                    new DeliveryId("del-1"),
                    new RoleAgentId("agent-1"),
                    "secret-value",
                    "small")))
        ]);

        var query = new TraceQueryService(store);
        var timeline = await query.GetCorrelationTimelineAsync("corr-1", new TraceQueryOptions(IncludeDetails: false), CancellationToken.None);

        Assert.Single(timeline.Items);
        Assert.Null(timeline.Items[0].Details);
    }

    [Fact]
    public async Task TraceQueryService_GetAgentTimelineAsync_ReturnsEventsLinkedToAgent()
    {
        var store = NewStore();
        var mapper = new TraceEventMapper();
        var at1 = DateTimeOffset.UtcNow.AddMinutes(-3);
        var at2 = at1.AddMinutes(1);
        var at3 = at2.AddMinutes(1);
        var atOther = at2.AddSeconds(30);

        await store.WriteBatchAsync([
            mapper.Map(Envelope("evt-agent-1-a", new TestTraceEvent(new CommandId("cmd-agent-1-a"), new DeliveryId("del-agent-1-a"), new RoleAgentId("agent-1"), "none", "one"), at1, "corr-agent-1-a")),
            mapper.Map(Envelope("evt-agent-1-b", new TestTraceEvent(new CommandId("cmd-agent-1-b"), new DeliveryId("del-agent-1-b"), new RoleAgentId("agent-1"), "none", "two"), at2, "corr-agent-1-b")),
            mapper.Map(Envelope("evt-agent-1-c", new TestTraceEvent(new CommandId("cmd-agent-1-c"), new DeliveryId("del-agent-1-c"), new RoleAgentId("agent-1"), "none", "three"), at3, "corr-agent-1-c")),
            mapper.Map(Envelope("evt-agent-2-a", new TestTraceEvent(new CommandId("cmd-agent-2-a"), new DeliveryId("del-agent-2-a"), new RoleAgentId("agent-2"), "none", "other"), atOther, "corr-agent-2-a"))
        ]);

        var query = new TraceQueryService(store);
        var limited = await query.GetAgentTimelineAsync("agent-1", new TraceQueryOptions(Limit: 2), CancellationToken.None);

        Assert.Equal("agent", limited.Subject.Type);
        Assert.Equal("agent-1", limited.Subject.Id);
        Assert.Equal(new[] { "evt-agent-1-a", "evt-agent-1-b" }, limited.Items.Select(x => x.EventId).ToArray());
        Assert.All(limited.Items, item => Assert.Contains("agent-1", item.EventId, StringComparison.Ordinal));
        Assert.NotEmpty(limited.Links);
        Assert.Contains(limited.Links, link =>
            (link.From.Type == "agent" && link.From.Id == "agent-1")
            || (link.To.Type == "agent" && link.To.Id == "agent-1"));
        Assert.Equal(2, limited.Count);
        Assert.True(limited.HasMore);

        var ranged = await query.GetAgentTimelineAsync("agent-1", new TraceQueryOptions(Limit: 10, From: at2.AddTicks(1)), CancellationToken.None);
        Assert.Equal(new[] { "evt-agent-1-c" }, ranged.Items.Select(x => x.EventId).ToArray());
        Assert.False(ranged.HasMore);
    }

    [Fact]
    public async Task TraceQueryService_ValidateInvariantsAsync_DelegatesToInvariantChecker()
    {
        var store = NewStore();
        var old = DateTimeOffset.UtcNow.AddMinutes(-5);
        await store.WriteBatchAsync([
            new TraceProjectionDelta(
                Event("evt-stuck-delivery", "DeliveryInitialized", "del-stuck", old),
                [new TraceEntityRecord("delivery", "del-stuck", "pending", "pending", "evt-stuck-delivery", old, "{\"deliveryId\":\"del-stuck\"}")],
                [])
        ]);

        var checker = new TraceInvariantChecker(store, TimeSpan.FromSeconds(1));
        var query = new TraceQueryService(store, checker);

        var expected = await checker.ValidateInvariantsAsync(CancellationToken.None);
        var actual = await query.ValidateInvariantsAsync(CancellationToken.None);

        Assert.Equal(expected.Select(x => x.InvariantId).ToArray(), actual.Select(x => x.InvariantId).ToArray());
        Assert.Equal(expected.Select(x => x.Message).ToArray(), actual.Select(x => x.Message).ToArray());
        var invariant = Assert.Single(actual);
        Assert.StartsWith("INV-001", invariant.InvariantId, StringComparison.Ordinal);
        Assert.Equal("delivery", invariant.EntityType);
        Assert.Equal("del-stuck", invariant.EntityId);
        Assert.Equal("open", invariant.Status);
        Assert.Contains("still pending", invariant.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static TraceStore NewStore() => new($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-trace-test-{Guid.NewGuid():N}.sqlite")}");

    private static AvenEventEnvelope<TestTraceEvent> Envelope(string eventId, TestTraceEvent data, DateTimeOffset? at = null, string correlationId = "corr-1") => new(
        new EventMetadata(eventId, nameof(TestTraceEvent), 1, new ActorAddress("test/actor", "local"), "TestActor", data.CommandId, data.DeliveryId, null, new CorrelationId(correlationId), null, "hash", at ?? DateTimeOffset.UtcNow),
        data);

    private static AvenEventEnvelope<TestTraceEvent> EventEnvelope(string eventId, string eventType, TestTraceEvent data, DateTimeOffset? at = null, string correlationId = "corr-1") => new(
        new EventMetadata(eventId, eventType, 1, new ActorAddress("test/actor", "local"), "TestActor", data.CommandId, data.DeliveryId, null, new CorrelationId(correlationId), null, "hash", at ?? DateTimeOffset.UtcNow),
        data);

    private static TraceEventRecord Event(string eventId, string eventType, string deliveryId, DateTimeOffset at) =>
        new(eventId, eventType, 1, "test/actor", "TestActor", "cmd-1", deliveryId, null, "corr-1", null, "hash", at, eventType, "{}", false);
}

public sealed class TraceProjectionActorTests : TestKit
{
    [Fact]
    public async Task ProjectionActor_ReceivesEventStreamEnvelope_AndFlushes()
    {
        var store = new TraceStore($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-trace-actor-{Guid.NewGuid():N}.sqlite")}");
        var actor = Sys.ActorOf(Props.Create(() => new TraceProjectionActor(store, null, 10, TimeSpan.FromSeconds(10))));
        var envelope = new AvenEventEnvelope<TestTraceEvent>(
            new EventMetadata("evt-stream", nameof(TestTraceEvent), 1, new ActorAddress("test/actor", "local"), "TestActor", new CommandId("cmd-1"), new DeliveryId("del-1"), null, new CorrelationId("corr-stream"), null, "hash", DateTimeOffset.UtcNow),
            new TestTraceEvent(new CommandId("cmd-1"), new DeliveryId("del-1"), new RoleAgentId("agent-1"), "none", "small"));

        var query = new TraceQueryService(store);
        for (var attempt = 0; attempt < 20; attempt++)
        {
            Sys.EventStream.Publish(envelope);
            await Task.Delay(50);
            _ = await actor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), TimeSpan.FromSeconds(3));
            var timeline = await query.GetCorrelationTimelineAsync("corr-stream", new TraceQueryOptions(), CancellationToken.None);
            if (timeline.Items.Count == 1)
            {
                return;
            }
        }

        var finalTimeline = await query.GetCorrelationTimelineAsync("corr-stream", new TraceQueryOptions(), CancellationToken.None);
        Assert.Single(finalTimeline.Items);
    }

    [Fact]
    public async Task ProjectionActor_FlushesLargeBurst_WithoutLossOrDuplication()
    {
        const string correlationId = "corr-burst";
        const int totalEvents = 60;
        var store = NewStore("burst");
        var actor = Sys.ActorOf(Props.Create(() => new TraceProjectionActor(store, null, 10, TimeSpan.FromSeconds(10))));
        var query = new TraceQueryService(store);

        for (var i = 0; i < totalEvents; i++)
        {
            actor.Tell(Envelope($"evt-burst-{i}", new TestTraceEvent(new CommandId("cmd-burst"), new DeliveryId($"del-burst-{i}"), new RoleAgentId("agent-burst"), "none", $"value-{i}"), correlationId: correlationId));
        }

        _ = await actor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), TimeSpan.FromSeconds(5));
        var timeline = await WaitForTimelineCountAsync(query, correlationId, totalEvents, 500);

        Assert.Equal(totalEvents, timeline.Items.Count);
        Assert.Equal(totalEvents, timeline.Items.Select(x => x.EventId).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task ProjectionActor_RetriesBufferedEvents_AfterWriteFailure()
    {
        var store = new FailingOnceTraceStore($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-trace-retry-{Guid.NewGuid():N}.sqlite")}");
        var actor = Sys.ActorOf(Props.Create(() => new TraceProjectionActor(store, null, 2, TimeSpan.FromMilliseconds(25))));
        var query = new TraceQueryService(store);

        actor.Tell(Envelope("evt-retry-1", new TestTraceEvent(new CommandId("cmd-retry"), new DeliveryId("del-retry-1"), new RoleAgentId("agent-retry"), "none", "one"), correlationId: "corr-retry"));
        actor.Tell(Envelope("evt-retry-2", new TestTraceEvent(new CommandId("cmd-retry"), new DeliveryId("del-retry-2"), new RoleAgentId("agent-retry"), "none", "two"), correlationId: "corr-retry"));

        var flushed = await actor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), TimeSpan.FromSeconds(5));
        var timeline = await WaitForTimelineCountAsync(query, "corr-retry", 2);
        var health = await actor.Ask<TraceProjectionHealth>(new GetTraceProjectionHealth(), TimeSpan.FromSeconds(5));

        Assert.Equal(2, timeline.Items.Count);
        Assert.Equal(2, timeline.Items.Select(x => x.EventId).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(2, flushed.EventsWritten);
        Assert.True(store.WriteAttempts >= 2);
        Assert.Equal(1, health.FailureCount);
        Assert.Equal("Simulated trace store failure.", health.LastError);
    }

    [Fact]
    public async Task ProjectionActor_HandlesOverlappingThresholdTimerAndManualFlushes_WithoutDuplication()
    {
        const string correlationId = "corr-overlap";
        var store = new BlockingTraceStore($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-trace-overlap-{Guid.NewGuid():N}.sqlite")}");
        var actor = Sys.ActorOf(Props.Create(() => new TraceProjectionActor(store, null, 2, TimeSpan.FromMilliseconds(20))));
        var query = new TraceQueryService(store);

        actor.Tell(Envelope("evt-overlap-1", new TestTraceEvent(new CommandId("cmd-overlap"), new DeliveryId("del-overlap-1"), new RoleAgentId("agent-overlap"), "none", "one"), correlationId: correlationId));
        actor.Tell(Envelope("evt-overlap-2", new TestTraceEvent(new CommandId("cmd-overlap"), new DeliveryId("del-overlap-2"), new RoleAgentId("agent-overlap"), "none", "two"), correlationId: correlationId));

        await store.FirstWriteStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));

        actor.Tell(Envelope("evt-overlap-3", new TestTraceEvent(new CommandId("cmd-overlap"), new DeliveryId("del-overlap-3"), new RoleAgentId("agent-overlap"), "none", "three"), correlationId: correlationId));
        actor.Tell(Envelope("evt-overlap-4", new TestTraceEvent(new CommandId("cmd-overlap"), new DeliveryId("del-overlap-4"), new RoleAgentId("agent-overlap"), "none", "four"), correlationId: correlationId));

        var manualFlushTask = actor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), TimeSpan.FromSeconds(5));
        store.ReleaseFirstWrite();

        var flushed = await manualFlushTask;
        var timeline = await WaitForTimelineCountAsync(query, correlationId, 4, 50);

        Assert.Equal(4, timeline.Items.Count);
        Assert.Equal(4, timeline.Items.Select(x => x.EventId).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(4, flushed.EventsWritten);
        Assert.True(store.WriteAttempts >= 2);
    }

    [Fact]
    public async Task TraceProjection_DropsEventsAndReportsUnhealthy_WhenBufferLimitExceeded()
    {
        var store = NewStore("overflow");
        var actor = Sys.ActorOf(Props.Create(() => new TraceProjectionActor(store, null, new TraceProjectionOptions(BatchSize: 100, FlushInterval: TimeSpan.FromSeconds(10), MaxBufferedEvents: 2))));
        var query = new TraceQueryService(store);

        actor.Tell(Envelope("evt-overflow-1", new TestTraceEvent(new CommandId("cmd-overflow"), new DeliveryId("del-overflow-1"), new RoleAgentId("agent-overflow"), "none", "one"), "corr-overflow"));
        actor.Tell(Envelope("evt-overflow-2", new TestTraceEvent(new CommandId("cmd-overflow"), new DeliveryId("del-overflow-2"), new RoleAgentId("agent-overflow"), "none", "two"), "corr-overflow"));
        actor.Tell(Envelope("evt-overflow-3", new TestTraceEvent(new CommandId("cmd-overflow"), new DeliveryId("del-overflow-3"), new RoleAgentId("agent-overflow"), "none", "three"), "corr-overflow"));

        _ = await actor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), TimeSpan.FromSeconds(5));
        var timeline = await WaitForTimelineCountAsync(query, "corr-overflow", 2);
        var health = await actor.Ask<TraceProjectionHealth>(new GetTraceProjectionHealth(), TimeSpan.FromSeconds(5));

        Assert.Equal(2, timeline.Items.Count);
        Assert.False(health.Healthy);
        Assert.Equal(1, health.EventsDropped);
        Assert.Equal(0, health.ManualFlushesRejected);
        Assert.Equal(0, health.FailureCount);
        Assert.Equal(0, health.BufferedEvents);
        Assert.Contains("trace_projection_buffer_overflow", health.LastError, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TraceProjection_ManualFlushWaitersAreBounded()
    {
        var store = new BlockingTraceStore($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-trace-manual-waiter-{Guid.NewGuid():N}.sqlite")}");
        var actor = Sys.ActorOf(Props.Create(() => new TraceProjectionActor(store, null, new TraceProjectionOptions(BatchSize: 1, FlushInterval: TimeSpan.FromSeconds(10), MaxBufferedEvents: 10, MaxManualFlushWaiters: 1))));

        actor.Tell(Envelope("evt-manual-1", new TestTraceEvent(new CommandId("cmd-manual"), new DeliveryId("del-manual-1"), new RoleAgentId("agent-manual"), "none", "one"), "corr-manual"));
        await store.FirstWriteStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var firstFlush = actor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), TimeSpan.FromSeconds(5));
        var secondFlush = actor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), TimeSpan.FromSeconds(5));

        store.ReleaseFirstWrite();

        _ = await firstFlush;
        await Assert.ThrowsAnyAsync<Exception>(async () => await secondFlush);

        var health = await actor.Ask<TraceProjectionHealth>(new GetTraceProjectionHealth(), TimeSpan.FromSeconds(5));
        Assert.Equal(1, health.ManualFlushesRejected);
    }

    private static AvenEventEnvelope<TestTraceEvent> Envelope(string eventId, TestTraceEvent data, string correlationId) => new(
        new EventMetadata(eventId, nameof(TestTraceEvent), 1, new ActorAddress("test/actor", "local"), "TestActor", data.CommandId, data.DeliveryId, null, new CorrelationId(correlationId), null, "hash", DateTimeOffset.UtcNow),
        data);

    private static async Task<TraceTimelineResult> WaitForTimelineCountAsync(TraceQueryService query, string correlationId, int expectedCount, int limit = 200)
    {
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var timeline = await query.GetCorrelationTimelineAsync(correlationId, new TraceQueryOptions(Limit: limit), CancellationToken.None);
            if (timeline.Items.Count == expectedCount)
            {
                return timeline;
            }

            await Task.Delay(50);
        }

        return await query.GetCorrelationTimelineAsync(correlationId, new TraceQueryOptions(Limit: limit), CancellationToken.None);
    }

    private static TraceStore NewStore(string suffix) =>
        new($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-trace-{suffix}-{Guid.NewGuid():N}.sqlite")}");

    private sealed class FailingOnceTraceStore(string connectionString) : TraceStore(connectionString)
    {
        private int _writeAttempts;
        public int WriteAttempts => Volatile.Read(ref _writeAttempts);

        internal override Task<TraceStoreWriteResult> WriteBatchAsync(IReadOnlyList<TraceProjectionDelta> deltas, CancellationToken cancellationToken = default)
        {
            var attempt = Interlocked.Increment(ref _writeAttempts);
            return attempt == 1
                ? Task.FromException<TraceStoreWriteResult>(new InvalidOperationException("Simulated trace store failure."))
                : base.WriteBatchAsync(deltas, cancellationToken);
        }
    }

    private sealed class BlockingTraceStore(string connectionString) : TraceStore(connectionString)
    {
        private readonly TaskCompletionSource<bool> _firstWriteStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _releaseFirstWrite = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _writeAttempts;

        public TaskCompletionSource<bool> FirstWriteStarted => _firstWriteStarted;
        public int WriteAttempts => Volatile.Read(ref _writeAttempts);

        public void ReleaseFirstWrite() => _releaseFirstWrite.TrySetResult(true);

        internal override async Task<TraceStoreWriteResult> WriteBatchAsync(IReadOnlyList<TraceProjectionDelta> deltas, CancellationToken cancellationToken = default)
        {
            var attempt = Interlocked.Increment(ref _writeAttempts);
            if (attempt == 1)
            {
                _firstWriteStarted.TrySetResult(true);
                await _releaseFirstWrite.Task.WaitAsync(cancellationToken);
            }

            return await base.WriteBatchAsync(deltas, cancellationToken);
        }
    }
}