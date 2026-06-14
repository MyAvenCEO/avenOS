using System.Text.Json;
using Akka.Actor;
using Akka.Configuration;
using Akka.TestKit.Xunit2;
using Aven.Events.Interfaces;
using Aven.Events.Models;
using Aven.RoleAgents;

namespace Aven.Tests.RoleAgents;

public sealed class Phase32RoleAgentLedgerProjectionDurabilityTests : TestKit, IAsyncLifetime
{
    private readonly string _journalDatabasePath = Path.Combine(Path.GetTempPath(), $"aven-phase32-journal-{Guid.NewGuid():N}.sqlite");
    private readonly string _ledgerDatabasePath = Path.Combine(Path.GetTempPath(), $"aven-phase32-ledger-{Guid.NewGuid():N}.sqlite");

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task RoleAgentLedgerProjection_BackfillsPersistedEvents_AfterProjectionRestart()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(
                Props.Create(() => new RoleAgentActor(
                    "phase32/agent",
                    new RoleAgentId("agent-contract-1"),
                    new RoleDescriptor("contract_watcher", "Contract Watcher"),
                    "Track contract renewals")),
                "phase32-agent");

            var accepted = await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-phase32"), TimeSpan.FromSeconds(3));
            Assert.Equal("agent_input_recorded", accepted.AcceptanceKind);

            await WaitForPendingOperationAsync(actor);
        });

        await WithSystem(async system =>
        {
            var ledger = new RoleAgentLedgerStore($"Data Source={_ledgerDatabasePath}");

            Assert.Empty(await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), null, null, CancellationToken.None));
            Assert.Empty(await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None));
            Assert.Empty(await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None));

            _ = system.ActorOf(Props.Create(() => new RoleAgentLedgerProjectionActor(ledger)), "phase32-ledger-projection");

            await WaitForLedgerRowsAsync(ledger, "projection restart backfill");
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task RoleAgentLedgerBackfillReader_ReplaysPersistedRoleAgentEventsFromSqliteJournal()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(
                Props.Create(() => new RoleAgentActor(
                    "phase32/direct-replay-agent",
                    new RoleAgentId("agent-contract-1"),
                    new RoleDescriptor("contract_watcher", "Contract Watcher"),
                    "Track contract renewals")),
                "phase32-direct-replay-agent");

            var accepted = await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-phase32-direct-replay"), TimeSpan.FromSeconds(3));
            Assert.Equal("agent_input_recorded", accepted.AcceptanceKind);

            await WaitForPendingOperationAsync(actor);
        });

        await WithSystem(async system =>
        {
            var ledger = new RoleAgentLedgerStore($"Data Source={_ledgerDatabasePath}.direct.sqlite");
            var backfillReader = new RoleAgentLedgerBackfillReader();

            await backfillReader.ReplayAsync(system, ledger);

            await WaitForLedgerRowsAsync(ledger, "direct backfill replay");
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task RoleAgentLedgerProjection_BackfillThenRecoveredLiveEvents_DoNotDuplicateOrLoseRows()
    {
        const string persistenceId = "phase32/overlap-agent";
        const string claimId = "claim-phase32-overlap";

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(
                Props.Create(() => new RoleAgentActor(
                    persistenceId,
                    new RoleAgentId("agent-contract-1"),
                    new RoleDescriptor("contract_watcher", "Contract Watcher"),
                    "Track contract renewals")),
                "phase32-overlap-agent");

            var accepted = await actor.Ask<DeliveryAccepted>(CreateCommittedOffer(claimId), TimeSpan.FromSeconds(3));
            Assert.Equal("agent_input_recorded", accepted.AcceptanceKind);

            await WaitForPendingOperationAsync(actor);
        });

        await WithSystem(async system =>
        {
            var ledger = new RoleAgentLedgerStore($"Data Source={_ledgerDatabasePath}.overlap.sqlite");
            _ = system.ActorOf(Props.Create(() => new RoleAgentLedgerProjectionActor(ledger)), "phase32-overlap-ledger-projection");

            var recoveredActor = system.ActorOf(
                Props.Create(() => new RoleAgentActor(
                    persistenceId,
                    new RoleAgentId("agent-contract-1"),
                    new RoleDescriptor("contract_watcher", "Contract Watcher"),
                    "Track contract renewals")),
                "phase32-overlap-agent-recovered");

            var recoveredState = await recoveredActor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(recoveredState.PendingOperations.Values);

            await WaitForLedgerRowsAsync(ledger, "projection overlap initial replay");

            var nextState = await recoveredActor.Ask<RoleAgentState>(Resolved(pending, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            Assert.DoesNotContain(nextState.PendingOperations.Values, x => x.OperationId == pending.OperationId);

            await AssertEventually(async () =>
            {
                var workItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), null, null, CancellationToken.None);
                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None);
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None);
                var completed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Completed, null, CancellationToken.None);

                Assert.Single(workItems);
                Assert.Single(runs);
                Assert.Equal(operations.Select(x => x.OperationId.Value).Distinct(StringComparer.Ordinal).Count(), operations.Count);
                Assert.Contains(completed, x => x.OperationId == pending.OperationId);
            }, attempts: 50, delayMs: 100);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task RoleAgentLedgerProjection_ReportsHealthWhileIdle()
    {
        await WithSystem(async system =>
        {
            var ledger = new RoleAgentLedgerStore($"Data Source={_ledgerDatabasePath}.health.sqlite");
            var actor = system.ActorOf(Props.Create(() => new RoleAgentLedgerProjectionActor(ledger)));

            var health = await AssertEventuallyHealthAsync(async () =>
                await actor.Ask<RoleAgentLedgerProjectionHealth>(new GetRoleAgentLedgerProjectionHealth(), TimeSpan.FromSeconds(3)),
                static item => item.Idle);

            Assert.True(health.Idle);
            Assert.False(health.BackfillInProgress);
            Assert.False(health.ApplyInProgress);
            Assert.Equal(0, health.BufferedLiveEvents);
            Assert.Equal(0, health.PendingApplies);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task RoleAgentLedgerProjection_FailsLoudly_WhenBackfillLiveBufferOverflows()
    {
        await WithSystem(async system =>
        {
            var ledger = new RoleAgentLedgerStore($"Data Source={_ledgerDatabasePath}.overflow-backfill.sqlite");
            var backfillBlock = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var childReady = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);
            var childStopped = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);

            _ = system.ActorOf(Props.Create(() => new StopOnFailureParent(
                childReady,
                childStopped,
                Props.Create(() => new RoleAgentLedgerProjectionActor(
                    ledger,
                    new RoleAgentLedgerProjectionOptions(MaxBufferedLiveEventsDuringBackfill: 1, MaxPendingApplies: 10),
                    (_, _) => backfillBlock.Task,
                    null)))));

            var actor = await childReady.Task.WaitAsync(TimeSpan.FromSeconds(3));
            actor.Tell(LedgerEnvelope("evt-ledger-overflow-backfill-1", "op-backfill-1"));
            actor.Tell(LedgerEnvelope("evt-ledger-overflow-backfill-2", "op-backfill-2"));

            var terminated = await childStopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(actor, terminated);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task RoleAgentLedgerProjection_FailsLoudly_WhenPendingApplyQueueOverflows()
    {
        await WithSystem(async system =>
        {
            var ledger = new RoleAgentLedgerStore($"Data Source={_ledgerDatabasePath}.overflow-pending.sqlite");
            var applyBlock = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var childReady = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);
            var childStopped = new TaskCompletionSource<IActorRef>(TaskCreationOptions.RunContinuationsAsynchronously);

            _ = system.ActorOf(Props.Create(() => new StopOnFailureParent(
                childReady,
                childStopped,
                Props.Create(() => new RoleAgentLedgerProjectionActor(
                    ledger,
                    new RoleAgentLedgerProjectionOptions(MaxBufferedLiveEventsDuringBackfill: 10, MaxPendingApplies: 1),
                    null,
                    _ => applyBlock.Task)))));

            var actor = await childReady.Task.WaitAsync(TimeSpan.FromSeconds(3));
            await AssertEventuallyHealthAsync(async () =>
                await actor.Ask<RoleAgentLedgerProjectionHealth>(new GetRoleAgentLedgerProjectionHealth(), TimeSpan.FromSeconds(3)),
                static health => health.Idle);

            actor.Tell(LedgerEnvelope("evt-ledger-overflow-pending-1", "op-pending-1"));
            actor.Tell(LedgerEnvelope("evt-ledger-overflow-pending-2", "op-pending-2"));
            actor.Tell(LedgerEnvelope("evt-ledger-overflow-pending-3", "op-pending-3"));

            var terminated = await childStopped.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(actor, terminated);
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_journalDatabasePath))
        {
            File.Delete(_journalDatabasePath);
        }

        if (File.Exists(_ledgerDatabasePath))
        {
            File.Delete(_ledgerDatabasePath);
        }

        return Task.CompletedTask;
    }

    private async Task WithSystem(Func<ActorSystem, Task> action)
    {
        var config = ConfigurationFactory.ParseString($$"""
            akka {
              loglevel = WARNING
              stdout-loglevel = WARNING
              persistence {
                journal.plugin = "akka.persistence.journal.sqlite"
                snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
                journal.sqlite {
                  class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_journalDatabasePath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_journalDatabasePath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase32-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private sealed class StopOnFailureParent : ReceiveActor
    {
        private readonly TaskCompletionSource<IActorRef> _childReady;
        private readonly TaskCompletionSource<IActorRef> _childStopped;
        private readonly Props _childProps;

        public StopOnFailureParent(
            TaskCompletionSource<IActorRef> childReady,
            TaskCompletionSource<IActorRef> childStopped,
            Props childProps)
        {
            _childReady = childReady;
            _childStopped = childStopped;
            _childProps = childProps;
            Receive<Terminated>(message => _childStopped.TrySetResult(message.ActorRef));
        }

        protected override void PreStart()
        {
            var child = Context.ActorOf(_childProps, "projection-child");
            Context.Watch(child);
            _childReady.TrySetResult(child);
        }

        protected override SupervisorStrategy SupervisorStrategy() =>
            new OneForOneStrategy(static _ => Directive.Stop);
    }

    private static DeliveryAttemptOffer CreateCommittedOffer(string claimId)
    {
        var command = new ContractWatcherDocumentCommand(
            new RoutingAttemptId($"route-{claimId}"),
            new WorkOfferId($"offer-{claimId}"),
            new WorkClaimId(claimId),
            new RoleAgentId("agent-contract-1"),
            "lease-2027.pdf",
            Array.Empty<string>(),
            "lease renewal packet",
            "contracts.renewal",
            "router proposal",
            [new SchemaRef("schema://contracts/contract-summary@1")],
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"));

        var committed = new CommittedWorkItem(
            new WorkClaimId(claimId),
            new RoutingAttemptId($"route-{claimId}"),
            new RoleAgentId("agent-contract-1"),
            "lease-2027.pdf",
            Array.Empty<string>(),
            "lease renewal packet",
            "contracts.ingest_document",
            JsonSerializer.Serialize(command),
            "contracts",
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"),
            "contracts.renewal",
            "router proposal");

        var payload = JsonSerializer.Serialize(committed);
        var envelope = new AvenEnvelope<string>(
            new CommandId($"cmd-{claimId}"),
            new MessageId($"msg-{claimId}"),
            new ActorAddress("intake/a", "local"),
            new ActorAddress("agent/agent-contract-1", "local"),
            new ActorAddress("intake/a", "local"),
            new CorrelationId($"corr-{claimId}"),
            CommittedWorkItem.MessageType,
            1,
            payload,
            null,
            null,
            DateTimeOffset.UtcNow);

        return new DeliveryAttemptOffer(new DeliveryId($"delivery-{claimId}"), envelope, PersistedCommandPayload.FromInlineJson(payload).Hash);
    }

    private static async Task AssertEventually(Func<Task> assertion, int attempts, int delayMs)
    {
        Exception? last = null;
        for (var i = 0; i < attempts; i++)
        {
            try
            {
                await assertion();
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                await Task.Delay(delayMs);
            }
        }

        throw last ?? new InvalidOperationException("Expected assertion to succeed eventually.");
    }

    private static async Task WaitForPendingOperationAsync(IActorRef actor)
    {
        await AssertEventually(async () =>
        {
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));

            Assert.Single(state.OpenWorkItems);
            Assert.Single(state.ActiveRuns);
            Assert.Single(state.PendingOperations);
        }, attempts: 50, delayMs: 100);
    }

    private static async Task WaitForLedgerRowsAsync(RoleAgentLedgerStore ledger, string context)
    {
        Exception? last = null;
        for (var i = 0; i < 50; i++)
        {
            try
            {
                var workItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), null, null, CancellationToken.None);
                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None);
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None);

                Assert.Single(workItems);
                Assert.Single(runs);
                Assert.Single(operations);
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                await Task.Delay(100);
            }
        }

        var finalWorkItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), null, null, CancellationToken.None);
        var finalRuns = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None);
        var finalOperations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None);
        throw new Xunit.Sdk.XunitException($"{context} did not produce the expected ledger rows. workItems={finalWorkItems.Count}, runs={finalRuns.Count}, operations={finalOperations.Count}. Last error: {last?.Message}");
    }

    private static async Task<RoleAgentLedgerProjectionHealth> AssertEventuallyHealthAsync(Func<Task<RoleAgentLedgerProjectionHealth>> getValue, Func<RoleAgentLedgerProjectionHealth, bool> predicate)
    {
        Exception? last = null;
        for (var attempt = 0; attempt < 50; attempt++)
        {
            try
            {
                var value = await getValue();
                if (predicate(value))
                {
                    return value;
                }
            }
            catch (Exception ex)
            {
                last = ex;
            }

            await Task.Delay(50);
        }

        throw last ?? new InvalidOperationException("Expected health assertion to succeed eventually.");
    }

    private static IAvenEventEnvelope LedgerEnvelope(string eventId, string operationId) =>
        new AvenEventEnvelope<OperationRequested>(
            new EventMetadata(
                eventId,
                nameof(OperationRequested),
                1,
                new ActorAddress("agent/ledger", "local"),
                "RoleAgentActor",
                null,
                null,
                new OperationKey(new ActorAddress("agent/ledger", "local"), new RequestId(operationId), "metadata.create"),
                new CorrelationId($"corr-{operationId}"),
                null,
                "hash",
                DateTimeOffset.UtcNow),
            new OperationRequested(
                new OperationId(operationId),
                new RunId("run-overflow"),
                new WorkItemId("work-overflow"),
                new RoleAgentId("agent-contract-1"),
                new OperationKey(new ActorAddress("agent/ledger", "local"), new RequestId(operationId), "metadata.create"),
                "metadata",
                "metadata.create",
                "{}",
                DateTimeOffset.UtcNow));

    private static OperationResolved Resolved(PendingOperationState pending, string valueJson) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}/worker", "local"),
            new OperationValue(pending.ContractId, valueJson));

    private static string ContractExtractionJson() =>
        "{\"structuredJson\":{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"2030-01-01T00:00:00Z\",\"reminderText\":\"Review lease renewal\",\"renewalTermJson\":{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"2030-01-01T00:00:00Z\"}}}";

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);
}