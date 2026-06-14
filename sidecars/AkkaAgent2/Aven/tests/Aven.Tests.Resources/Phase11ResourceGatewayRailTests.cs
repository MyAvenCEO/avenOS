using System.Text.Json;
using System.Collections.Concurrent;
using Akka.Actor;
using Microsoft.Data.Sqlite;
using Aven.Akka.Hosting;
using Aven.Capabilities.Contracts.Models;
using Aven.Contracts.Messaging;
using Aven.Contracts.Protocol;
using Aven.Resources.Metadata;
using Aven.Resources.Metadata.Contracts;
using Aven.Resources.Metadata.Contracts.Commands;
using Aven.Resources.Metadata.Contracts.Models;
using Aven.Resources.Metadata.Contracts.Responses;
using Aven.Resources.Runtime.Gateways;
using Aven.Scheduling.Gateways;
using Aven.Resources.Runtime.Inbox;
using Aven.Scheduling.Contracts;

namespace Aven.Tests.Resources;

public sealed class Phase11ResourceGatewayRailTests
{
    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_DoesNotBlockMailboxWhileRecordingIntent()
    {
        using var system = ActorSystem.Create($"phase11-rail-record-intent-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-record-intent-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-record-intent", "local");
        resolver.Register(replyTo, replyTarget);

        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore();
        inboxStore.BlockNextRecordIntent();
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)), "phase11-rail-record-intent-gateway");

        var firstTask = gateway.Ask<object>(CreateOffer(CreatePayload(null), replyTo), TimeSpan.FromSeconds(10));
        await inboxStore.WaitForBlockedRecordIntentAsync(TimeSpan.FromSeconds(3));

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var invalidResult = await gateway.Ask<object>(CreateOffer("{bad json", replyTo), TimeSpan.FromSeconds(2));
        stopwatch.Stop();

        var rejected = Assert.IsType<DeliveryRejected>(invalidResult);
        Assert.Equal("invalid_schedule_payload", rejected.Error.Code);
        Assert.True(stopwatch.ElapsedMilliseconds < 250, $"Expected invalid payload rejection while record intent was pending, but took {stopwatch.ElapsedMilliseconds}ms.");

        inboxStore.ReleaseBlockedRecordIntent();

        var accepted = Assert.IsType<DeliveryAccepted>(await firstTask);
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
        await WaitForConditionAsync(() => tracker.CreatedCount == 1, TimeSpan.FromSeconds(5));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_DoesNotBlockMailboxWhileMarkingTerminal()
    {
        using var system = ActorSystem.Create($"phase11-rail-mark-terminal-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-mark-terminal-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-mark-terminal", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore();
        inboxStore.BlockNextMarkCompleted();
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)), "phase11-rail-mark-terminal-gateway");

        var accepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(CreatePayload(null), replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
        _ = await WaitForMessageAsync<OperationResolved>(replyRecorder, TimeSpan.FromSeconds(5));
        await inboxStore.WaitForBlockedMarkCompletedAsync(TimeSpan.FromSeconds(3));

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var invalidResult = await gateway.Ask<object>(CreateOffer("{bad json", replyTo), TimeSpan.FromSeconds(2));
        stopwatch.Stop();

        var rejected = Assert.IsType<DeliveryRejected>(invalidResult);
        Assert.Equal("invalid_schedule_payload", rejected.Error.Code);
        Assert.True(stopwatch.ElapsedMilliseconds < 250, $"Expected invalid payload rejection while mark completed was pending, but took {stopwatch.ElapsedMilliseconds}ms.");

        inboxStore.ReleaseBlockedMarkCompleted();
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_RecordIntentFailureRejectsWithoutSideEffect()
    {
        using var system = ActorSystem.Create($"phase11-rail-record-failure-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-record-failure-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-record-failure", "local");
        resolver.Register(replyTo, replyTarget);

        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore
        {
            RecordIntentException = new ResourceOperationInboxStore.ResourceOperationInboxConflictException("duplicate-operation")
        };
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)), "phase11-rail-record-failure-gateway");

        var result = await gateway.Ask<object>(CreateOffer(CreatePayload(null), replyTo), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("resource_operation_conflict", rejected.Error.Code);
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_StoreCommandFailure_IsNotIgnored()
    {
        using var system = ActorSystem.Create($"phase11-rail-store-command-failure-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-store-command-failure-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-store-command-failure", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore { MarkProcessingExceptionCount = 1 };
        var childStopped = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);

        var adapter = system.ActorOf(Props.Create(() => new StopOnFailureParent(
            childStopped,
            Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)))), "phase11-rail-store-command-failure-parent");

        var accepted = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(CreateOffer(CreatePayload(null), replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);

        var terminated = await childStopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(terminated.IsNobody());
        Assert.Equal(0, tracker.CreatedCount);

        var recorded = await inboxStore.GetAsync(inboxStore.LastRecordedOperationKey!, CancellationToken.None);
        Assert.NotNull(recorded);
        Assert.Equal(ResourceOperationInboxStatus.Recorded, recorded!.Status);
        Assert.Equal(1, inboxStore.MarkProcessingAttempts);

        var messages = await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.DoesNotContain(messages, static x => x is OperationResolved);
        Assert.DoesNotContain(messages, static x => x is Aven.Contracts.Operations.OperationFailed);

        var exception = new ResourceOperationInboxStoreCommandException("mark_processing", inboxStore.LastRecordedOperationKey, new InvalidOperationException("boom"));
        Assert.Equal("mark_processing", exception.OperationName);
        Assert.Equal(inboxStore.LastRecordedOperationKey, exception.OperationKey);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_GatewayRestart_RecoversAcceptedInboxOperation()
    {
        using var system = ActorSystem.Create($"phase11-rail-restart-recovery-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-restart-recovery-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-restart-recovery", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore { MarkProcessingExceptionCount = 1 };
        var gateway = system.ActorOf(Props.Create(() => new RestartParent(
            Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)))), "phase11-rail-restart-recovery-parent");

        var accepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(CreatePayload(null), replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);

        var resolved = await WaitForMessageAsync<OperationResolved>(replyRecorder, TimeSpan.FromSeconds(5));
        Assert.Equal("schedule.create", resolved.Value.Kind);
        Assert.Equal(1, tracker.CreatedCount);
        Assert.Equal(2, inboxStore.MarkProcessingAttempts);
        Assert.True(inboxStore.ListRecoverableCallCount >= 2, $"Expected startup recovery to run on start and restart, but observed {inboxStore.ListRecoverableCallCount} recoverable-list calls.");

        var messages = await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.Single(messages.OfType<OperationResolved>());

        var recorded = await inboxStore.GetAsync(inboxStore.LastRecordedOperationKey!, CancellationToken.None);
        Assert.NotNull(recorded);
        Assert.Equal(ResourceOperationInboxStatus.Completed, recorded!.Status);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_ListRecoverableFailure_FailsLoudly()
    {
        using var system = ActorSystem.Create($"phase11-rail-list-recoverable-failure-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore
        {
            ListRecoverableException = new InvalidOperationException("recoverable list failed")
        };
        var childStopped = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);

        _ = system.ActorOf(Props.Create(() => new StopOnFailureParent(
            childStopped,
            Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)))), "phase11-rail-list-recoverable-failure-parent");

        var terminated = await childStopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(terminated.IsNobody());
        Assert.Equal(0, tracker.CreatedCount);
        Assert.True(inboxStore.ListRecoverableCallCount >= 1);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_RejectsUnsupportedOperationType()
    {
        using var system = ActorSystem.Create($"phase11-rail-unsupported-message-type-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-unsupported-message-type-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-unsupported-message-type", "local");
        resolver.Register(replyTo, replyTarget);

        var tracker = new ScheduleFactoryTracker();
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, new ControlledInboxStore())), "phase11-rail-unsupported-message-type-gateway");

        var result = await gateway.Ask<object>(CreateOffer(CreatePayload(null), replyTo, messageType: "schedule.cancel"), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("unsupported_operation_type", rejected.Error.Code);
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_CapabilityAdmissionFailureRejectsWithoutSideEffect()
    {
        using var system = ActorSystem.Create($"phase11-rail-capability-admission-failure-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-capability-admission-failure-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-capability-admission-failure", "local");
        resolver.Register(replyTo, replyTarget);

        var tracker = new ScheduleFactoryTracker();
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(
            tracker.Create,
            resolver,
            new ControlledInboxStore(),
            new ThrowingCapabilityAdmissionClient(new InvalidOperationException("capability store unavailable")))), "phase11-rail-capability-admission-failure-gateway");

        var result = await gateway.Ask<object>(CreateOffer(CreatePayload("schedule-capability-check-failure"), replyTo), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("capability_admission_failed", rejected.Error.Code);
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_DuplicateProcessingOperation_IsAcceptedWithoutRestartingWork()
    {
        using var system = ActorSystem.Create($"phase11-rail-duplicate-processing-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-duplicate-processing-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-duplicate-processing", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker();
        tracker.BlockNextCreate();
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, new ControlledInboxStore())), "phase11-rail-duplicate-processing-gateway");

        var payload = CreatePayload(null);
        var firstAccepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(payload, replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", firstAccepted.AcceptanceKind);
        await tracker.WaitForBlockedCreateAsync(TimeSpan.FromSeconds(3));

        var secondAccepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(payload, replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", secondAccepted.AcceptanceKind);
        Assert.Equal(1, tracker.CreatedCount);

        var messagesBeforeRelease = await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.DoesNotContain(messagesBeforeRelease, static x => x is OperationResolved);

        tracker.ReleaseBlockedCreate();

        var resolved = await WaitForMessageAsync<OperationResolved>(replyRecorder, TimeSpan.FromSeconds(5));
        Assert.Equal("schedule.create", resolved.Value.Kind);

        var messages = await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.Single(messages.OfType<OperationResolved>());
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_DuplicateCompletedOperation_IsAcceptedWithoutRestartingWork()
    {
        using var system = ActorSystem.Create($"phase11-rail-duplicate-completed-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-duplicate-completed-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-duplicate-completed", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker();
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, new ControlledInboxStore())), "phase11-rail-duplicate-completed-gateway");

        var payload = CreatePayload(null);
        var firstAccepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(payload, replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", firstAccepted.AcceptanceKind);
        _ = await WaitForMessageAsync<OperationResolved>(replyRecorder, TimeSpan.FromSeconds(5));

        var secondAccepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(payload, replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", secondAccepted.AcceptanceKind);
        Assert.Equal(1, tracker.CreatedCount);

        var messages = await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.Single(messages.OfType<OperationResolved>());
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_DuplicateFailedOperation_IsAcceptedWithoutRestartingWork()
    {
        using var system = ActorSystem.Create($"phase11-rail-duplicate-failed-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-duplicate-failed-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-duplicate-failed", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker { CreateException = new InvalidOperationException("schedule creation exploded") };
        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, new ControlledInboxStore())), "phase11-rail-duplicate-failed-gateway");

        var payload = CreatePayload(null);
        var firstAccepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(payload, replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", firstAccepted.AcceptanceKind);
        var failed = await WaitForMessageAsync<Aven.Contracts.Operations.OperationFailed>(replyRecorder, TimeSpan.FromSeconds(5));
        Assert.Equal("schedule_create_failed", failed.Error.Code);

        var secondAccepted = Assert.IsType<DeliveryAccepted>(await gateway.Ask<object>(CreateOffer(payload, replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", secondAccepted.AcceptanceKind);
        Assert.Equal(1, tracker.CreatedCount);

        var messages = await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.Single(messages.OfType<Aven.Contracts.Operations.OperationFailed>());
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_RecoveryWithUnresolvedReplyTarget_MarksFailed()
    {
        using var system = ActorSystem.Create($"phase11-rail-recovery-unresolved-reply-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore();
        const string operationKey = "local|agent/test|schedule-recovery-unresolved-reply|schedule.create";
        var payload = CreatePayload(null);

        await inboxStore.RecordIntentAsync(new ResourceOperationInboxRecord(
            operationKey,
            "agent/test",
            "local",
            "schedule-recovery-unresolved-reply",
            "schedule.create",
            "schedule",
            "resource/schedule",
            "local",
            "tests/replies/schedule-recovery-unresolved-reply",
            "local",
            "corr-schedule-recovery-unresolved-reply",
            payload,
            payload,
            ResourceOperationInboxStatus.Recorded,
            DateTimeOffset.UtcNow,
            null,
            null,
            null,
            null,
            0));

        _ = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)), "phase11-rail-recovery-unresolved-reply-gateway");

        await WaitForConditionAsync(async () =>
        {
            var updated = await inboxStore.GetAsync(operationKey, CancellationToken.None);
            return updated is { Status: ResourceOperationInboxStatus.Failed, LastErrorCode: "resource_owner_unresolved_after_recovery" };
        }, TimeSpan.FromSeconds(5));
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_RecoverCompletedOperation_DoesNotRestart()
    {
        using var system = ActorSystem.Create($"phase11-rail-recovery-completed-no-restart-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-recovery-completed-no-restart-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-recovery-completed-no-restart", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore();
        await inboxStore.RecordIntentAsync(CreateScheduleInboxRecord(
            requestId: "schedule-recovery-completed-no-restart",
            payload: CreatePayload(null),
            replyTo: replyTo,
            status: ResourceOperationInboxStatus.Completed,
            completedAt: DateTimeOffset.UtcNow,
            operationKey: "local|agent/test|schedule-recovery-completed-no-restart|schedule.create"));

        var gateway = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)), "phase11-rail-recovery-completed-no-restart-gateway");
        gateway.Tell(new RecoverResourceOperations());

        await Task.Delay(250);
        Assert.Equal(0, tracker.CreatedCount);
        Assert.Empty(await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1)));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationInboxStore_InvalidLegacyStatus_FailsFast()
    {
        var store = CreateInboxStore("legacy-status-invalid");
        var connectionString = GetInboxConnectionString(store);

        await using (var connection = new SqliteConnection(connectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                insert into resource_operation_inbox(
                  operation_key, caller_value, caller_protocol, request_id, operation_type,
                  resource_kind, recipient_value, recipient_protocol, reply_to_value, reply_to_protocol,
                  correlation_id, payload_json, payload_hash, resolved_capability_id, terminal_reply_kind, terminal_reply_payload_json,
                  terminal_reply_delivery_status, terminal_reply_delivered_at, status, accepted_at, started_at,
                  completed_at, last_error_code, last_error_message, attempt_count)
                values(
                  $operationKey, 'agent/test', 'local', 'req-legacy', 'schedule.create',
                  'schedule', 'resource/schedule', 'local', 'tests/replies/schedule', 'local',
                  'corr-legacy', '{"requestId":"req-legacy"}', 'hash-legacy', null, null, null,
                  null, null, 'Accepted', $acceptedAt, null,
                  null, null, null, 0);
                """;
            command.Parameters.AddWithValue("$operationKey", "local|agent/test|req-legacy|schedule.create");
            command.Parameters.AddWithValue("$acceptedAt", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }

        await Assert.ThrowsAsync<ArgumentException>(() => store.ListRecoverableAsync("schedule", CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => store.GetAsync("local|agent/test|req-legacy|schedule.create", CancellationToken.None));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationInboxStore_TerminalReplyCompleted_IsIdempotentForSamePayload_AndConflictsForDifferentPayloadOrStatus()
    {
        var store = CreateInboxStore("terminal-reply-completed");
        var replyTo = new ActorAddress("tests/replies/terminal-reply-completed", "local");
        const string operationKey = "local|agent/test|terminal-reply-completed|schedule.create";

        await store.RecordIntentAsync(CreateScheduleInboxRecord(
            requestId: "terminal-reply-completed",
            payload: CreatePayload("schedule-valid"),
            replyTo: replyTo,
            status: ResourceOperationInboxStatus.Completed,
            operationKey: operationKey,
            completedAt: DateTimeOffset.UtcNow));

        var terminalReply = new ResourceOperationInboxStore.TerminalReplyRecord(
            ResourceOperationInboxStatus.Completed,
            ResourceOperationTypes.ScheduleCreate,
            "{\"scheduleId\":\"schedule-valid\"}",
            null,
            null);

        var first = await store.TryRecordTerminalReplyPendingAsync(operationKey, terminalReply, CancellationToken.None);
        Assert.NotNull(first);
        Assert.Equal(ResourceOperationInboxStatus.Completed, first!.Status);
        Assert.Equal(ResourceOperationTerminalReplyDeliveryStatus.Pending, first.TerminalReplyDeliveryStatus);

        var second = await store.TryRecordTerminalReplyPendingAsync(operationKey, terminalReply, CancellationToken.None);
        Assert.NotNull(second);
        Assert.Equal(first, second);

        await Assert.ThrowsAsync<ResourceOperationInboxStore.ResourceOperationInboxConflictException>(() =>
            store.TryRecordTerminalReplyPendingAsync(
                operationKey,
                terminalReply with { ReplyPayloadJson = "{\"scheduleId\":\"schedule-other\"}" },
                CancellationToken.None));

        await Assert.ThrowsAsync<ResourceOperationInboxStore.ResourceOperationInboxConflictException>(() =>
            store.TryRecordTerminalReplyPendingAsync(
                operationKey,
                terminalReply with { TerminalStatus = ResourceOperationInboxStatus.Failed, ErrorCode = "schedule_failed", ErrorMessage = "schedule failed" },
                CancellationToken.None));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationInboxStore_TerminalReplyFailed_IsIdempotentForSamePayload_AndConflictsForDifferentPayloadOrStatus()
    {
        var store = CreateInboxStore("terminal-reply-failed");
        var replyTo = new ActorAddress("tests/replies/terminal-reply-failed", "local");
        const string operationKey = "local|agent/test|terminal-reply-failed|schedule.create";

        await store.RecordIntentAsync(CreateScheduleInboxRecord(
            requestId: "terminal-reply-failed",
            payload: CreatePayload("schedule-valid"),
            replyTo: replyTo,
            status: ResourceOperationInboxStatus.Failed,
            operationKey: operationKey,
            completedAt: DateTimeOffset.UtcNow,
            lastErrorCode: "schedule_failed",
            lastErrorMessage: "schedule failed"));

        var terminalReply = new ResourceOperationInboxStore.TerminalReplyRecord(
            ResourceOperationInboxStatus.Failed,
            ResourceOperationTypes.ScheduleCreate,
            "{\"error\":\"schedule failed\"}",
            "schedule_failed",
            "schedule failed");

        var first = await store.TryRecordTerminalReplyPendingAsync(operationKey, terminalReply, CancellationToken.None);
        Assert.NotNull(first);
        Assert.Equal(ResourceOperationInboxStatus.Failed, first!.Status);
        Assert.Equal(ResourceOperationTerminalReplyDeliveryStatus.Pending, first.TerminalReplyDeliveryStatus);

        var second = await store.TryRecordTerminalReplyPendingAsync(operationKey, terminalReply, CancellationToken.None);
        Assert.NotNull(second);
        Assert.Equal(first, second);

        await Assert.ThrowsAsync<ResourceOperationInboxStore.ResourceOperationInboxConflictException>(() =>
            store.TryRecordTerminalReplyPendingAsync(
                operationKey,
                terminalReply with { ReplyKind = ResourceOperationTypes.HumanAnswer, ReplyPayloadJson = "{\"error\":\"different\"}" },
                CancellationToken.None));

        await Assert.ThrowsAsync<ResourceOperationInboxStore.ResourceOperationInboxConflictException>(() =>
            store.TryRecordTerminalReplyPendingAsync(
                operationKey,
                terminalReply with { TerminalStatus = ResourceOperationInboxStatus.Completed, ErrorCode = null, ErrorMessage = null, ReplyPayloadJson = "{\"scheduleId\":\"schedule-valid\"}" },
                CancellationToken.None));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_MarkCompletedFailure_IsNotIgnored()
    {
        using var system = ActorSystem.Create($"phase11-rail-mark-completed-failure-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-mark-completed-failure-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-mark-completed-failure", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker();
        var inboxStore = new ControlledInboxStore { MarkCompletedExceptionCount = 1 };
        var childStopped = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);
        var adapter = system.ActorOf(Props.Create(() => new StopOnFailureParent(
            childStopped,
            Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)))), "phase11-rail-mark-completed-failure-parent");

        var accepted = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(CreateOffer(CreatePayload(null), replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
        _ = await WaitForMessageAsync<OperationResolved>(replyRecorder, TimeSpan.FromSeconds(5));

        var terminated = await childStopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(terminated.IsNobody());
        Assert.Equal(1, tracker.CreatedCount);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ResourceOperationRail_MarkFailedFailure_IsNotIgnored()
    {
        using var system = ActorSystem.Create($"phase11-rail-mark-failed-failure-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-rail-mark-failed-failure-reply");
        var replyTo = new ActorAddress("tests/replies/phase11-rail-mark-failed-failure", "local");
        resolver.Register(replyTo, replyRecorder);

        var tracker = new ScheduleFactoryTracker { CreateException = new InvalidOperationException("schedule create failed") };
        var inboxStore = new ControlledInboxStore { MarkFailedExceptionCount = 1 };
        var childStopped = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);
        var adapter = system.ActorOf(Props.Create(() => new StopOnFailureParent(
            childStopped,
            Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, inboxStore)))), "phase11-rail-mark-failed-failure-parent");

        var accepted = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(CreateOffer(CreatePayload(null), replyTo), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
        var failed = await WaitForMessageAsync<Aven.Contracts.Operations.OperationFailed>(replyRecorder, TimeSpan.FromSeconds(5));
        Assert.Equal("schedule_create_failed", failed.Error.Code);

        var terminated = await childStopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(terminated.IsNobody());
        Assert.Equal(1, tracker.CreatedCount);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ScheduleAdapter_RejectsCreateWhenCapabilityIdIsMissing()
    {
        using var system = ActorSystem.Create($"phase11-schedule-adapter-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-reply-recorder");
        var replyTo = new ActorAddress("tests/replies/schedule-adapter", "local");
        resolver.Register(replyTo, replyTarget);

        var tracker = new ScheduleFactoryTracker();
        var adapter = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, CreateInboxStore("schedule-adapter"), new InMemoryCapabilityAdmissionClient())), "phase11-schedule-adapter");

        var payload = JsonSerializer.Serialize(new ScheduledWorkOperationPayload(
            RequestId: "schedule-create-no-capability",
            ScheduleId: "schedule-capability-missing",
            TargetAgent: new ActorAddress("agent/test", "local"),
            TargetOperationType: "research.run_digest",
            CommandPayloadJson: "{\"paperId\":\"P-1\"}",
            DueAt: DateTimeOffset.UtcNow.AddMinutes(5),
            CorrelationId: new CorrelationId("corr-schedule-create-no-capability"),
            Summary: "schedule without capability",
            CapabilityId: null));

        var offer = new DeliveryAttemptOffer(
            new DeliveryId($"delivery-{Guid.NewGuid():N}"),
            new AvenEnvelope<string>(
                new CommandId($"command-{Guid.NewGuid():N}"),
                new MessageId($"message-{Guid.NewGuid():N}"),
                new ActorAddress("agent/test", "local"),
                new ActorAddress("resource/schedule", "local"),
                replyTo,
                new CorrelationId($"corr-{Guid.NewGuid():N}"),
                "schedule.create",
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            $"payload-{Guid.NewGuid():N}");

        var result = await adapter.Ask<object>(offer, TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("capability_required", rejected.Error.Code);
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    public async Task ScheduleAdapter_RejectsCreateWhenCapabilityGrantIsUnknown()
    {
        using var system = ActorSystem.Create($"phase11-schedule-adapter-unknown-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-reply-recorder-unknown");
        var replyTo = new ActorAddress("tests/replies/schedule-unknown", "local");
        resolver.Register(replyTo, replyTarget);
        var tracker = new ScheduleFactoryTracker();
        var adapter = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, CreateInboxStore("schedule-adapter-unknown"), new InMemoryCapabilityAdmissionClient())), "phase11-schedule-adapter-unknown");

        var result = await adapter.Ask<object>(CreateOffer(CreatePayload("cap-unknown"), replyTo), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("capability_missing", rejected.Error.Code);
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    public async Task ScheduleAdapter_RejectsCreateWhenCapabilityHolderTargetOrMessageTypeMismatch()
    {
        using var system = ActorSystem.Create($"phase11-schedule-adapter-mismatch-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-reply-recorder-mismatch");
        var replyTo = new ActorAddress("tests/replies/schedule-mismatch", "local");
        resolver.Register(replyTo, replyTarget);
        var tracker = new ScheduleFactoryTracker();
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant("schedule-wrong-holder", new ActorAddress("agent/other", "local"), new ActorAddress("resource/schedule", "local"), "schedule.create"));
        authority.UpsertGrant(CreateGrant("schedule-wrong-target", new ActorAddress("agent/test", "local"), new ActorAddress("resource/metadata", "local"), "schedule.create"));
        authority.UpsertGrant(CreateGrant("schedule-wrong-message", new ActorAddress("agent/test", "local"), new ActorAddress("resource/schedule", "local"), "artifact.create"));
        var adapter = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, CreateInboxStore("schedule-adapter-mismatch"), authority)), "phase11-schedule-adapter-mismatch");

        async Task<DeliveryRejected> RunAsync(string capabilityId)
            => Assert.IsType<DeliveryRejected>(await adapter.Ask<object>(CreateOffer(CreatePayload(capabilityId), replyTo), TimeSpan.FromSeconds(5)));

        Assert.Equal("capability_wrong_holder", (await RunAsync("schedule-wrong-holder")).Error.Code);
        Assert.Equal("capability_wrong_target", (await RunAsync("schedule-wrong-target")).Error.Code);
        Assert.Equal("capability_message_not_allowed", (await RunAsync("schedule-wrong-message")).Error.Code);
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    public async Task ScheduleAdapter_RejectsCreateWhenReplyTargetIsUnresolved_WithoutScheduleRegistration()
    {
        using var system = ActorSystem.Create($"phase11-schedule-adapter-reply-unresolved-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var tracker = new ScheduleFactoryTracker();
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant("schedule-valid-unresolved-reply", new ActorAddress("agent/test", "local"), new ActorAddress("resource/schedule", "local"), "schedule.create"));
        var adapter = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, CreateInboxStore("schedule-adapter-reply-unresolved"), authority)), "phase11-schedule-adapter-reply-unresolved");

        var result = await adapter.Ask<object>(CreateOffer(CreatePayload("schedule-valid-unresolved-reply"), new ActorAddress("tests/replies/schedule-unresolved", "local")), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("reply_target_unresolved", rejected.Error.Code);
        Assert.Equal(0, tracker.CreatedCount);
    }

    [Fact]
    public async Task ScheduleAdapter_AdmitsCreateWhenCapabilityGrantIsValid()
    {
        using var system = ActorSystem.Create($"phase11-schedule-adapter-valid-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-reply-recorder-valid");
        var replyTo = new ActorAddress("tests/replies/schedule-valid", "local");
        resolver.Register(replyTo, replyTarget);
        var tracker = new ScheduleFactoryTracker();
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant("schedule-valid", new ActorAddress("agent/test", "local"), new ActorAddress("resource/schedule", "local"), "schedule.create"));
        var adapter = system.ActorOf(Props.Create(() => new ScheduleGatewayActor(tracker.Create, resolver, CreateInboxStore("schedule-adapter-valid"), authority)), "phase11-schedule-adapter-valid");

        var result = await adapter.Ask<object>(CreateOffer(CreatePayload("schedule-valid"), replyTo), TimeSpan.FromSeconds(5));

        Assert.IsType<DeliveryAccepted>(result);
        await WaitForConditionAsync(() => tracker.CreatedCount == 1, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task MetadataOperationAdapter_RejectsWhenReplyTargetUnresolved_WithoutMetadataSideEffect()
    {
        using var system = ActorSystem.Create($"phase11-metadata-adapter-unresolved-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var metadataActor = system.ActorOf(Props.Create(() => new MetadataStoreActor(
            $"metadata-unresolved-{Guid.NewGuid():N}",
            static (_, _) => MetadataValidationResult.Success)), "phase11-metadata-store-unresolved");
        var adapter = system.ActorOf(Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, CreateInboxStore("metadata-adapter-unresolved"))), "phase11-metadata-adapter-unresolved");

        var result = await adapter.Ask<object>(CreateMetadataOffer(CreateMetadataPayload("metadata-reply-unresolved"), new ActorAddress("tests/replies/metadata-unresolved", "local")), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("reply_target_unresolved", rejected.Error.Code);

        var records = await metadataActor.Ask<MetadataRecord[]>(new MetadataInspectAll(), TimeSpan.FromSeconds(3));
        Assert.Empty(records);
    }

    [Fact]
    public async Task MetadataOperationAdapter_ValidPlan_CreatesRecordAndRepliesResolved()
    {
        using var system = ActorSystem.Create($"phase11-metadata-adapter-valid-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-metadata-reply-recorder-valid");
        var replyTo = new ActorAddress("tests/replies/metadata-valid", "local");
        resolver.Register(replyTo, recorder);
        var metadataActor = system.ActorOf(Props.Create(() => new MetadataStoreActor(
            $"metadata-valid-{Guid.NewGuid():N}",
            static (_, _) => MetadataValidationResult.Success)), "phase11-metadata-store-valid");
        var inboxStore = CreateInboxStore("metadata-adapter-valid");
        var adapter = system.ActorOf(Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, inboxStore)), "phase11-metadata-adapter-valid");

        var payload = CreateMetadataPayload("metadata-valid-request");
        var result = await adapter.Ask<object>(CreateMetadataOffer(payload, replyTo), TimeSpan.FromSeconds(5));

        Assert.IsType<DeliveryAccepted>(result);

        var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal("metadata.create", resolved.Key.OperationType);
        Assert.Equal("metadata-valid-request", resolved.Key.RequestId.Value);

        using var resolvedJson = JsonDocument.Parse(resolved.Value.ValueJson);
        var recordId = resolvedJson.RootElement.GetProperty("recordId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(recordId));

        var records = await metadataActor.Ask<MetadataRecord[]>(new MetadataInspectAll(), TimeSpan.FromSeconds(3));
        var record = Assert.Single(records);
        Assert.Equal(recordId, record.RecordId);
        Assert.Equal("artifact-revision", record.Subject.Kind);
        Assert.Equal("artifact-rev-1", record.Subject.Id);
        Assert.Equal(new SchemaRef("schema://research/digest@1"), record.SchemaRef);
        Assert.Equal("{\"summary\":\"digest\"}", record.Json);
        Assert.Equal("generated digest", record.SourceSummary);

        var recorded = await inboxStore.GetAsync("local|agent/test|metadata-valid-request|metadata.create", CancellationToken.None);
        Assert.NotNull(recorded);
        Assert.Null(recorded!.ResolvedCapabilityId);
    }

    [Fact]
    public async Task MetadataOperationAdapter_UsesEnvelopeCapabilityId_WhenPayloadCapabilityIdIsMissing()
    {
        using var system = ActorSystem.Create($"phase11-metadata-adapter-envelope-capability-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-metadata-reply-recorder-envelope-capability");
        var replyTo = new ActorAddress("tests/replies/metadata-envelope-capability", "local");
        resolver.Register(replyTo, recorder);
        var metadataActor = system.ActorOf(Props.Create(() => new MetadataStoreActor(
            $"metadata-envelope-capability-{Guid.NewGuid():N}",
            static (_, _) => MetadataValidationResult.Success)), "phase11-metadata-store-envelope-capability");
        var inboxStore = CreateInboxStore("metadata-adapter-envelope-capability");
        var adapter = system.ActorOf(Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, inboxStore)), "phase11-metadata-adapter-envelope-capability");

        var payload = CreateMetadataPayload("metadata-envelope-capability-request");
        var originalOffer = CreateMetadataOffer(payload, replyTo);
        var offer = originalOffer with
        {
            Envelope = originalOffer.Envelope with { CapabilityId = new CapabilityId("metadata-envelope-capability") }
        };

        var accepted = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(offer, TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
        _ = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));

        var recorded = await inboxStore.GetAsync("local|agent/test|metadata-envelope-capability-request|metadata.create", CancellationToken.None);
        Assert.NotNull(recorded);
        Assert.Equal("metadata-envelope-capability", recorded!.ResolvedCapabilityId);
    }

    [Fact]
    public async Task MetadataOperationAdapter_RejectsPayloadEnvelopeCapabilityMismatch()
    {
        using var system = ActorSystem.Create($"phase11-metadata-adapter-capability-mismatch-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-metadata-reply-recorder-capability-mismatch");
        var replyTo = new ActorAddress("tests/replies/metadata-capability-mismatch", "local");
        resolver.Register(replyTo, recorder);
        var metadataActor = system.ActorOf(Props.Create(() => new MetadataStoreActor(
            $"metadata-capability-mismatch-{Guid.NewGuid():N}",
            static (_, _) => MetadataValidationResult.Success)), "phase11-metadata-store-capability-mismatch");
        var adapter = system.ActorOf(Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, CreateInboxStore("metadata-adapter-capability-mismatch"))), "phase11-metadata-adapter-capability-mismatch");

        var payload = JsonSerializer.Serialize(new MetadataWriteOperationPayload(
            RequestId: "metadata-capability-mismatch-request",
            SubjectKind: "artifact-revision",
            SubjectId: "artifact-rev-1",
            SchemaRef: new SchemaRef("schema://research/digest@1"),
            Json: "{\"summary\":\"digest\"}",
            SourceSummary: "generated digest",
            ArtifactId: new ArtifactId("artifact-1"),
            ArtifactRevisionId: new ArtifactRevisionId("revision-1"),
            CapabilityId: "metadata-payload-capability"));
        var originalOffer = CreateMetadataOffer(payload, replyTo);
        var offer = originalOffer with
        {
            Envelope = originalOffer.Envelope with { CapabilityId = new CapabilityId("metadata-envelope-capability") }
        };

        var rejected = Assert.IsType<DeliveryRejected>(await adapter.Ask<object>(offer, TimeSpan.FromSeconds(5)));
        Assert.Equal("capability_id_mismatch", rejected.Error.Code);
        Assert.Empty(await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public async Task MetadataOperationAdapter_RejectsMalformedPayload_WithoutMetadataSideEffect()
    {
        using var system = ActorSystem.Create($"phase11-metadata-adapter-malformed-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var metadataActor = system.ActorOf(Props.Create(() => new MetadataStoreActor(
            $"metadata-malformed-{Guid.NewGuid():N}",
            static (_, _) => MetadataValidationResult.Success)), "phase11-metadata-store-malformed");
        var adapter = system.ActorOf(Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, CreateInboxStore("metadata-adapter-malformed"))), "phase11-metadata-adapter-malformed");

        var malformedPayload = "{\"requestId\":\"missing-required-fields\"";
        var result = await adapter.Ask<object>(CreateMetadataOffer(malformedPayload, new ActorAddress("tests/replies/metadata-malformed", "local")), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("invalid_metadata_payload", rejected.Error.Code);

        var records = await metadataActor.Ask<MetadataRecord[]>(new MetadataInspectAll(), TimeSpan.FromSeconds(3));
        Assert.Empty(records);
    }

    [Fact]
    public async Task MetadataOperationAdapter_Query_ReturnsSnapshotsAndRepliesResolved()
    {
        using var system = ActorSystem.Create($"phase11-metadata-query-adapter-valid-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-metadata-query-reply-recorder-valid");
        var replyTo = new ActorAddress("tests/replies/metadata-query-valid", "local");
        resolver.Register(replyTo, recorder);
        var metadataActor = system.ActorOf(Props.Create(() => new MetadataStoreActor(
            $"metadata-query-valid-{Guid.NewGuid():N}",
            static (_, _) => MetadataValidationResult.Success)), "phase11-metadata-query-store-valid");
        var inboxStore = CreateInboxStore("metadata-query-adapter-valid");
        var adapter = system.ActorOf(Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, inboxStore)), "phase11-metadata-query-adapter-valid");

        var seedReply = await metadataActor.Ask<MetadataCreateReply>(new MetadataCreateCommand(new MetadataCreateRequest(
            new OperationKey(new ActorAddress("agent/test", "local"), new RequestId("seed-record"), ResourceOperationTypes.MetadataCreate),
            new CorrelationId("corr-seed-record"),
            new MetadataSubject("artifact-revision", "artifact-rev-1", new Aven.Toolkit.Core.Identifiers.ArtifactId("artifact-1"), new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId("revision-1")),
            new SchemaRef("schema://research/digest@1"),
            "{\"summary\":\"digest\"}",
            "generated digest")), TimeSpan.FromSeconds(3));
        Assert.IsType<MetadataCreateSucceeded>(seedReply);

        var payload = CreateMetadataQueryPayload("metadata-query-request");
        var result = await adapter.Ask<object>(CreateMetadataQueryOffer(payload, replyTo), TimeSpan.FromSeconds(5));

        Assert.IsType<DeliveryAccepted>(result);
        var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal(ResourceOperationTypes.MetadataQuery, resolved.Key.OperationType);
        Assert.Equal("metadata-query-request", resolved.Key.RequestId.Value);

        var queryResult = JsonSerializer.Deserialize<MetadataQueryOperationResult>(resolved.Value.ValueJson);
        Assert.NotNull(queryResult);
        Assert.False(queryResult!.TimedOut);
        Assert.Equal(10, queryResult.AppliedLimit);
        var snapshot = Assert.Single(queryResult.Records);
        Assert.Equal("artifact-revision", snapshot.SubjectKind);
        Assert.Equal("artifact-rev-1", snapshot.SubjectId);
        Assert.Equal("schema://research/digest@1", snapshot.SchemaRef);
        Assert.Equal("{\"summary\":\"digest\"}", snapshot.Json);
        Assert.Equal("artifact-1", snapshot.ArtifactId);
        Assert.Equal("revision-1", snapshot.ArtifactRevisionId);

        var recorded = await inboxStore.GetAsync("local|agent/test|metadata-query-request|metadata.query", CancellationToken.None);
        Assert.NotNull(recorded);
    }

    [Fact]
    public async Task MetadataOperationAdapter_Query_RequiresCapability_WhenAuthorityConfigured()
    {
        using var system = ActorSystem.Create($"phase11-metadata-query-adapter-capability-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var replyTarget = system.ActorOf(Props.Create(() => new RecordingActor()), "phase11-metadata-query-reply-recorder-capability");
        var replyTo = new ActorAddress("tests/replies/metadata-query-capability", "local");
        resolver.Register(replyTo, replyTarget);
        var metadataActor = system.ActorOf(Props.Create(() => new MetadataStoreActor(
            $"metadata-query-capability-{Guid.NewGuid():N}",
            static (_, _) => MetadataValidationResult.Success)), "phase11-metadata-query-store-capability");
        var adapter = system.ActorOf(Props.Create(() => new MetadataGatewayActor(metadataActor, resolver, CreateInboxStore("metadata-query-adapter-capability"), new InMemoryCapabilityAdmissionClient())), "phase11-metadata-query-adapter-capability");

        var result = await adapter.Ask<object>(CreateMetadataQueryOffer(CreateMetadataQueryPayload("metadata-query-no-capability"), replyTo), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("capability_required", rejected.Error.Code);
    }

    private static string CreatePayload(string? capabilityId) => JsonSerializer.Serialize(new ScheduledWorkOperationPayload(
        RequestId: capabilityId is null ? "schedule-create-no-capability" : $"schedule-{capabilityId}",
        ScheduleId: capabilityId is null ? "schedule-capability-missing" : $"schedule-{capabilityId}",
        TargetAgent: new ActorAddress("agent/test", "local"),
        TargetOperationType: "research.run_digest",
        CommandPayloadJson: "{\"paperId\":\"P-1\"}",
        DueAt: DateTimeOffset.UtcNow.AddMinutes(5),
        CorrelationId: new CorrelationId($"corr-{capabilityId ?? "schedule-create-no-capability"}"),
        Summary: "schedule adapter test",
        CapabilityId: capabilityId));

    private static DeliveryAttemptOffer CreateOffer(string payload, ActorAddress replyTo, string messageType = "schedule.create") =>
        new(
            new DeliveryId($"delivery-{Guid.NewGuid():N}"),
            new AvenEnvelope<string>(
                new CommandId($"command-{Guid.NewGuid():N}"),
                new MessageId($"message-{Guid.NewGuid():N}"),
                new ActorAddress("agent/test", "local"),
                new ActorAddress("resource/schedule", "local"),
                replyTo,
                new CorrelationId($"corr-{Guid.NewGuid():N}"),
                messageType,
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            $"payload-{Guid.NewGuid():N}");

    private static ResourceOperationInboxRecord CreateScheduleInboxRecord(
        string requestId,
        string payload,
        ActorAddress replyTo,
        ResourceOperationInboxStatus status,
        string? operationKey = null,
        DateTimeOffset? completedAt = null,
        string? lastErrorCode = null,
        string? lastErrorMessage = null,
        string? resolvedCapabilityId = null) =>
        new(
            operationKey ?? $"local|agent/test|{requestId}|schedule.create",
            "agent/test",
            "local",
            requestId,
            "schedule.create",
            "schedule",
            "resource/schedule",
            "local",
            replyTo.Value,
            replyTo.Protocol,
            $"corr-{requestId}",
            payload,
            payload,
            status,
            DateTimeOffset.UtcNow,
            status is ResourceOperationInboxStatus.Processing or ResourceOperationInboxStatus.Completed or ResourceOperationInboxStatus.Failed ? DateTimeOffset.UtcNow : null,
            completedAt,
            lastErrorCode,
            lastErrorMessage,
            status is ResourceOperationInboxStatus.Recorded ? 0 : 1,
            resolvedCapabilityId);

    private static string CreateMetadataPayload(string requestId) => JsonSerializer.Serialize(new MetadataWriteOperationPayload(
        RequestId: requestId,
        SubjectKind: "artifact-revision",
        SubjectId: "artifact-rev-1",
        SchemaRef: new SchemaRef("schema://research/digest@1"),
        Json: "{\"summary\":\"digest\"}",
        SourceSummary: "generated digest",
        ArtifactId: new ArtifactId("artifact-1"),
        ArtifactRevisionId: new ArtifactRevisionId("revision-1"),
        CapabilityId: null));

    private static string CreateMetadataQueryPayload(string requestId, string? capabilityId = null) => JsonSerializer.Serialize(new MetadataQueryOperationPayload(
        RequestId: requestId,
        SubjectKinds: ["artifact-revision"],
        SubjectIds: ["artifact-rev-1"],
        SchemaRefs: [new SchemaRef("schema://research/digest@1")],
        Limit: 10,
        TimeoutMilliseconds: 1000,
        CapabilityId: capabilityId));

    private static DeliveryAttemptOffer CreateMetadataQueryOffer(string payload, ActorAddress replyTo) =>
        new(
            new DeliveryId($"delivery-{Guid.NewGuid():N}"),
            new AvenEnvelope<string>(
                new CommandId($"command-{Guid.NewGuid():N}"),
                new MessageId($"message-{Guid.NewGuid():N}"),
                new ActorAddress("agent/test", "local"),
                new ActorAddress("resource/metadata", "local"),
                replyTo,
                new CorrelationId($"corr-{Guid.NewGuid():N}"),
                "metadata.query",
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            $"payload-{Guid.NewGuid():N}");

    private static DeliveryAttemptOffer CreateMetadataOffer(string payload, ActorAddress replyTo) =>
        new(
            new DeliveryId($"delivery-{Guid.NewGuid():N}"),
            new AvenEnvelope<string>(
                new CommandId($"command-{Guid.NewGuid():N}"),
                new MessageId($"message-{Guid.NewGuid():N}"),
                new ActorAddress("agent/test", "local"),
                new ActorAddress("resource/metadata", "local"),
                replyTo,
                new CorrelationId($"corr-{Guid.NewGuid():N}"),
                "metadata.create",
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            $"payload-{Guid.NewGuid():N}");

    private static async Task<TMessage> WaitForMessageAsync<TMessage>(IActorRef recorder, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var messages = await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
            var match = messages.OfType<TMessage>().FirstOrDefault();
            if (match is not null)
            {
                return match;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"Timed out waiting for {typeof(TMessage).Name}.");
    }

    private static CapabilityGrant CreateGrant(string id, ActorAddress holder, ActorAddress target, params string[] messageTypes) =>
        new(
            new CapabilityId(id),
            holder,
            target,
            messageTypes.ToHashSet(StringComparer.Ordinal),
            new CapabilityConstraints(MaxUses: 10),
            false,
            null,
            DateTimeOffset.UtcNow.AddMinutes(10),
            null);

    private static ResourceOperationInboxStore CreateInboxStore(string name) =>
        new(GetInboxConnectionString(name));

    private static string GetInboxConnectionString(string name)
        => $"Data Source={Path.Combine(Path.GetTempPath(), $"aven-tests-resources-{name}-{Guid.NewGuid():N}.sqlite")}";

    private static string GetInboxConnectionString(ResourceOperationInboxStore store)
    {
        var field = typeof(ResourceOperationInboxStore).GetField("_connectionString", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
            ?? throw new InvalidOperationException("ResourceOperationInboxStore connection string field not found.");
        return (string)(field.GetValue(store) ?? throw new InvalidOperationException("ResourceOperationInboxStore connection string was null."));
    }

    private sealed record GetRecordedMessages;

    private sealed class RecordingActor : ReceiveActor
    {
        private readonly List<object> _messages = new();

        public RecordingActor()
        {
            Receive<GetRecordedMessages>(_ => Sender.Tell(_messages.ToArray()));
            ReceiveAny(message => _messages.Add(message));
        }
    }

    private sealed class ScheduleFactoryTracker
    {
        public int CreatedCount { get; private set; }
        public Exception? CreateException { get; set; }

        private readonly TaskCompletionSource<bool> _createBlocked = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _createRelease = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private volatile bool _blockNextCreate;

        public void BlockNextCreate() => _blockNextCreate = true;
        public void ReleaseBlockedCreate() => _createRelease.TrySetResult(true);
        public Task WaitForBlockedCreateAsync(TimeSpan timeout) => _createBlocked.Task.WaitAsync(timeout);

        public IActorRef Create(object _)
        {
            CreatedCount++;
            if (_blockNextCreate)
            {
                _blockNextCreate = false;
                _createBlocked.TrySetResult(true);
                _createRelease.Task.GetAwaiter().GetResult();
            }

            if (CreateException is not null)
            {
                throw CreateException;
            }

            return ActorRefs.Nobody;
        }
    }

    private sealed class ThrowingCapabilityAdmissionClient(Exception exception) : ICapabilityAdmissionClient
    {
        public Task UpsertGrantAsync(CapabilityGrant grant) => Task.CompletedTask;
        public void UpsertGrant(CapabilityGrant grant) { }

        public Task<object> AdmitAsync(CapabilityAdmissionRequest request)
            => Task.FromException<object>(exception);

        public object Admit(CapabilityAdmissionRequest request)
            => throw exception;
    }

    private sealed class StopOnFailureParent : ReceiveActor
    {
        private readonly TaskCompletionSource<IActorRef> _childStopped;
        private readonly Props _childProps;

        public StopOnFailureParent(TaskCompletionSource<IActorRef> childStopped, Props childProps)
        {
            _childStopped = childStopped;
            _childProps = childProps;

            Receive<Terminated>(message => _childStopped.TrySetResult(message.ActorRef));
            ReceiveAny(message => Context.Child("resource-adapter").Forward(message));
        }

        protected override void PreStart()
        {
            var child = Context.ActorOf(_childProps, "resource-adapter");
            Context.Watch(child);
        }

        protected override SupervisorStrategy SupervisorStrategy()
            => new OneForOneStrategy(static _ => Directive.Stop);
    }

    private sealed class RestartParent : ReceiveActor
    {
        private readonly Props _childProps;

        public RestartParent(Props childProps)
        {
            _childProps = childProps;
            ReceiveAny(message => Context.Child("resource-adapter").Forward(message));
        }

        protected override void PreStart()
        {
            _ = Context.ActorOf(_childProps, "resource-adapter");
        }

        protected override SupervisorStrategy SupervisorStrategy()
            => new OneForOneStrategy(static _ => Directive.Restart);
    }

    private sealed class ControlledInboxStore : IResourceOperationInboxStore
    {
        private readonly ConcurrentDictionary<string, ResourceOperationInboxRecord> _records = new(StringComparer.Ordinal);
        private readonly TaskCompletionSource<bool> _recordIntentBlocked = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _recordIntentRelease = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _markCompletedBlocked = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _markCompletedRelease = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private volatile bool _blockNextRecordIntent;
        private volatile bool _blockNextMarkCompleted;
        private int _remainingMarkProcessingFailures;
        private int _remainingMarkCompletedFailures;
        private int _remainingMarkFailedFailures;

        public int MaxPayloadBytes => 1024 * 1024;
        public Exception? RecordIntentException { get; set; }
        public Exception? ListRecoverableException { get; set; }
        public Exception? MarkProcessingException { get; set; }
        public Exception? MarkCompletedException { get; set; }
        public Exception? MarkFailedException { get; set; }
        public int MarkProcessingExceptionCount
        {
            get => _remainingMarkProcessingFailures;
            set => _remainingMarkProcessingFailures = value;
        }
        public int MarkCompletedExceptionCount
        {
            get => _remainingMarkCompletedFailures;
            set => _remainingMarkCompletedFailures = value;
        }
        public int MarkFailedExceptionCount
        {
            get => _remainingMarkFailedFailures;
            set => _remainingMarkFailedFailures = value;
        }
        public int MarkProcessingAttempts { get; private set; }
        public int ListRecoverableCallCount { get; private set; }
        public string? LastRecordedOperationKey { get; private set; }

        public void BlockNextRecordIntent() => _blockNextRecordIntent = true;
        public void ReleaseBlockedRecordIntent() => _recordIntentRelease.TrySetResult(true);
        public Task WaitForBlockedRecordIntentAsync(TimeSpan timeout) => _recordIntentBlocked.Task.WaitAsync(timeout);

        public void BlockNextMarkCompleted() => _blockNextMarkCompleted = true;
        public void ReleaseBlockedMarkCompleted() => _markCompletedRelease.TrySetResult(true);
        public Task WaitForBlockedMarkCompletedAsync(TimeSpan timeout) => _markCompletedBlocked.Task.WaitAsync(timeout);

        public async Task<ResourceOperationInboxStore.RecordIntentResult> RecordIntentAsync(ResourceOperationInboxRecord candidate, CancellationToken cancellationToken = default)
        {
            if (RecordIntentException is not null)
            {
                throw RecordIntentException;
            }

            if (_blockNextRecordIntent)
            {
                _blockNextRecordIntent = false;
                _recordIntentBlocked.TrySetResult(true);
                await _recordIntentRelease.Task.WaitAsync(cancellationToken);
            }

            var result = _records.TryGetValue(candidate.OperationKey, out var existing)
                ? new ResourceOperationInboxStore.RecordIntentResult(existing, ResourceOperationInboxStore.RecordIntentDisposition.AlreadyRecordedNonTerminal)
                : new ResourceOperationInboxStore.RecordIntentResult(candidate, ResourceOperationInboxStore.RecordIntentDisposition.Inserted);

            _records[candidate.OperationKey] = result.Record;
            LastRecordedOperationKey = candidate.OperationKey;
            return result;
        }

        public Task<ResourceOperationInboxRecord?> GetAsync(string operationKey, CancellationToken cancellationToken = default)
            => Task.FromResult(_records.TryGetValue(operationKey, out var record) ? record : null);

        public Task<IReadOnlyList<ResourceOperationInboxRecord>> ListRecoverableAsync(string resourceKind, CancellationToken cancellationToken = default)
        {
            ListRecoverableCallCount++;
            if (ListRecoverableException is not null)
            {
                throw ListRecoverableException;
            }

            return Task.FromResult<IReadOnlyList<ResourceOperationInboxRecord>>(_records.Values.Where(x => x.ResourceKind == resourceKind && x.Status is ResourceOperationInboxStatus.Recorded or ResourceOperationInboxStatus.Processing).ToArray());
        }

        public Task<IReadOnlyList<ResourceOperationInboxRecord>> ListPendingTerminalRepliesAsync(string resourceKind, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<ResourceOperationInboxRecord>>(
                _records.Values.Where(x => x.ResourceKind == resourceKind && x.TerminalReplyDeliveryStatus == ResourceOperationTerminalReplyDeliveryStatus.Pending).ToArray());

        public Task<ResourceOperationInboxRecord?> MarkProcessingAsync(string operationKey, CancellationToken cancellationToken = default)
        {
            MarkProcessingAttempts++;
            if (_remainingMarkProcessingFailures > 0)
            {
                _remainingMarkProcessingFailures--;
                throw MarkProcessingException ?? new InvalidOperationException("MarkProcessingAsync failed.");
            }

            if (!_records.TryGetValue(operationKey, out var record))
            {
                return Task.FromResult<ResourceOperationInboxRecord?>(null);
            }

            var updated = record with
            {
                Status = ResourceOperationInboxStatus.Processing,
                StartedAt = record.StartedAt ?? DateTimeOffset.UtcNow,
                AttemptCount = record.AttemptCount + 1
            };
            _records[operationKey] = updated;
            return Task.FromResult<ResourceOperationInboxRecord?>(updated);
        }

        public async Task<ResourceOperationInboxRecord?> MarkCompletedAsync(string operationKey, CancellationToken cancellationToken = default)
        {
            if (_remainingMarkCompletedFailures > 0)
            {
                _remainingMarkCompletedFailures--;
                throw MarkCompletedException ?? new InvalidOperationException("MarkCompletedAsync failed.");
            }

            if (_blockNextMarkCompleted)
            {
                _blockNextMarkCompleted = false;
                _markCompletedBlocked.TrySetResult(true);
                await _markCompletedRelease.Task.WaitAsync(cancellationToken);
            }

            if (!_records.TryGetValue(operationKey, out var record))
            {
                return null;
            }

            var updated = record with
            {
                Status = ResourceOperationInboxStatus.Completed,
                CompletedAt = DateTimeOffset.UtcNow
            };
            _records[operationKey] = updated;
            return updated;
        }

        public Task<ResourceOperationInboxRecord?> MarkFailedAsync(string operationKey, string errorCode, string errorMessage, CancellationToken cancellationToken = default)
        {
            if (_remainingMarkFailedFailures > 0)
            {
                _remainingMarkFailedFailures--;
                throw MarkFailedException ?? new InvalidOperationException("MarkFailedAsync failed.");
            }

            if (!_records.TryGetValue(operationKey, out var record))
            {
                return Task.FromResult<ResourceOperationInboxRecord?>(null);
            }

            var updated = record with
            {
                Status = ResourceOperationInboxStatus.Failed,
                CompletedAt = DateTimeOffset.UtcNow,
                LastErrorCode = errorCode,
                LastErrorMessage = errorMessage
            };
            _records[operationKey] = updated;
            return Task.FromResult<ResourceOperationInboxRecord?>(updated);
        }

        public Task<ResourceOperationInboxRecord?> TryRecordTerminalReplyPendingAsync(string operationKey, ResourceOperationInboxStore.TerminalReplyRecord terminalReply, CancellationToken cancellationToken = default)
        {
            if (!_records.TryGetValue(operationKey, out var record))
            {
                return Task.FromResult<ResourceOperationInboxRecord?>(null);
            }

            if (record.TerminalReplyDeliveryStatus == ResourceOperationTerminalReplyDeliveryStatus.Delivered)
            {
                return Task.FromResult<ResourceOperationInboxRecord?>(record);
            }

            var updated = record with
            {
                Status = terminalReply.TerminalStatus,
                CompletedAt = record.CompletedAt ?? DateTimeOffset.UtcNow,
                LastErrorCode = terminalReply.ErrorCode,
                LastErrorMessage = terminalReply.ErrorMessage,
                TerminalReplyKind = terminalReply.ReplyKind,
                TerminalReplyPayloadJson = terminalReply.ReplyPayloadJson,
                TerminalReplyDeliveryStatus = ResourceOperationTerminalReplyDeliveryStatus.Pending,
                TerminalReplyDeliveredAt = null
            };
            _records[operationKey] = updated;
            return Task.FromResult<ResourceOperationInboxRecord?>(updated);
        }

        public Task<ResourceOperationInboxRecord?> MarkTerminalReplyDeliveredAsync(string operationKey, CancellationToken cancellationToken = default)
        {
            if (!_records.TryGetValue(operationKey, out var record))
            {
                return Task.FromResult<ResourceOperationInboxRecord?>(null);
            }

            var updated = record with
            {
                TerminalReplyDeliveryStatus = ResourceOperationTerminalReplyDeliveryStatus.Delivered,
                TerminalReplyDeliveredAt = record.TerminalReplyDeliveredAt ?? DateTimeOffset.UtcNow
            };
            _records[operationKey] = updated;
            return Task.FromResult<ResourceOperationInboxRecord?>(updated);
        }
    }

    private static async Task WaitForConditionAsync(Func<bool> predicate, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate())
            {
                return;
            }

            await Task.Delay(50);
        }

        Assert.True(predicate(), $"Condition was not met within {timeout}.");
    }

    private static async Task WaitForConditionAsync(Func<Task<bool>> predicate, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await predicate())
            {
                return;
            }

            await Task.Delay(50);
        }

        Assert.True(await predicate(), $"Condition was not met within {timeout}.");
    }
}