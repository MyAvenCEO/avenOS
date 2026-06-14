using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.RoleAgents;
using OperationCancelledReply = Aven.Contracts.Operations.OperationCancelled;
using OperationFailedReply = Aven.Contracts.Operations.OperationFailed;
using OperationTimedOutReply = Aven.Contracts.Operations.OperationTimedOut;

namespace Aven.Tests.RoleAgents;

public sealed class Phase21RoleAgentProtocolRailsTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase21-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public async Task StartRoleAgent_Twice_Is_Idempotent()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-start-twice");

            var first = await actor.Ask<StartRoleAgentAccepted>(new StartRoleAgent(), TimeSpan.FromSeconds(3));
            var second = await actor.Ask<StartRoleAgentAccepted>(new StartRoleAgent(), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Running, first.Status);
            Assert.Equal(RoleAgentStatus.Running, second.Status);
            Assert.Equal(RoleAgentStatus.Running, state.Status);
            Assert.Empty(state.OpenWorkItems);
            Assert.Empty(state.ActiveRuns);
            Assert.Empty(state.PendingOperations);
        });
    }

    [Fact]
    public async Task Unsupported_DeliveryAttemptOffer_MessageType_Is_Rejected()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-unsupported-envelope");

            var envelope = new AvenEnvelope<string>(
                new CommandId("cmd-unsupported"),
                new MessageId("msg-unsupported"),
                new ActorAddress("intake/a", "local"),
                new ActorAddress("agent/agent-contract-1", "local"),
                new ActorAddress("intake/a", "local"),
                new CorrelationId("corr-unsupported"),
                "unsupported.message",
                1,
                "{}",
                null,
                null,
                DateTimeOffset.UtcNow);

            var reply = await actor.Ask<DeliveryRejected>(
                new DeliveryAttemptOffer(new DeliveryId("delivery-unsupported"), envelope, PersistedCommandPayload.FromInlineJson("{}").Hash),
                TimeSpan.FromSeconds(3));

            Assert.Equal("unsupported_agent_delivery_message", reply.Error.Code);
            await AssertStateBounded(actor, RoleAgentStatus.Created, open: 0, active: 0, pending: 0);
        });
    }

    [Fact]
    public async Task Malformed_CommittedWorkItem_Payload_Is_Rejected_Without_State_Mutation()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-malformed-committed");
            var reply = await actor.Ask<DeliveryRejected>(CreateOffer("delivery-malformed-committed", CommittedWorkItem.MessageType, "{not-json"), TimeSpan.FromSeconds(3));

            Assert.Equal("invalid_agent_committed_input", reply.Error.Code);
            await AssertStateBounded(actor, RoleAgentStatus.Created, open: 0, active: 0, pending: 0);
        });
    }

    [Fact]
    public async Task Committed_Work_Targeting_Another_Agent_Is_Rejected_Without_State_Mutation()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-agent-id-mismatch");
            var payload = JsonSerializer.Serialize(CreateCommittedWorkItem("claim-agent-mismatch", new RoleAgentId("agent-other")));

            var reply = await actor.Ask<DeliveryRejected>(CreateOffer("delivery-agent-mismatch", CommittedWorkItem.MessageType, payload), TimeSpan.FromSeconds(3));

            Assert.Equal("agent_id_mismatch", reply.Error.Code);
            await AssertStateBounded(actor, RoleAgentStatus.Created, open: 0, active: 0, pending: 0);
        });
    }

    [Fact]
    public async Task Malformed_Scheduled_Work_Trigger_Payload_Is_Rejected_Without_State_Mutation()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-malformed-scheduled-trigger");
            var reply = await actor.Ask<DeliveryRejected>(CreateOffer("delivery-malformed-scheduled", ScheduledWorkTriggered.MessageType, "{not-json"), TimeSpan.FromSeconds(3));

            Assert.Equal("invalid_scheduled_input_payload", reply.Error.Code);
            await AssertStateBounded(actor, RoleAgentStatus.Created, open: 0, active: 0, pending: 0);
        });
    }

    [Theory]
    [InlineData("rejected", true)]
    [InlineData("rejected", false)]
    [InlineData("timed_out", true)]
    [InlineData("timed_out", false)]
    [InlineData("cancelled", false)]
    public async Task Terminal_Rejected_Delivery_Cases_Clear_Open_Run_And_Pending_State(string kind, bool retryable)
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, $"phase21-terminal-{kind}-{retryable}");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer($"claim-terminal-{kind}-{retryable}"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(before.PendingOperations.Values);

            object reply = kind switch
            {
                "rejected" => await actor.Ask<RoleAgentState>(Rejected(pending, "operation_rejected", "rejected for rail test", retryable), TimeSpan.FromSeconds(3)),
                "timed_out" => await actor.Ask<RoleAgentState>(TimedOut(pending, "operation_timeout", "timed out for rail test", retryable), TimeSpan.FromSeconds(3)),
                "cancelled" => await actor.Ask<RoleAgentState>(Cancelled(pending), TimeSpan.FromSeconds(3)),
                _ => throw new InvalidOperationException(kind)
            };

            var after = Assert.IsType<RoleAgentState>(reply);
            Assert.Empty(after.ActiveRuns);
            Assert.Empty(after.PendingOperations);
            Assert.Single(after.OpenWorkItems);
        });
    }

    [Fact]
    public async Task Legacy_OperationResolved_DeliveryOffer_Is_Rejected_Deterministically()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-legacy-operation-resolved-delivery");
            var resolved = new OperationResolved(
                new OperationKey(new ActorAddress("resource/unknown", "local"), new RequestId("not-pending"), "not.pending"),
                new CorrelationId("corr-not-pending"),
                new ActorAddress("resource/unknown", "local"),
                new ActorAddress("resource/unknown/worker", "local"),
                new OperationValue("not.pending", "{}"));

            var rejected = await actor.Ask<DeliveryRejected>(
                CreateOffer("delivery-unknown-operation-resolved", "operation.resolved", JsonSerializer.Serialize(resolved)),
                TimeSpan.FromSeconds(3));

            Assert.Equal("unsupported_agent_delivery_message", rejected.Error.Code);
            await AssertStateBounded(actor, RoleAgentStatus.Created, open: 0, active: 0, pending: 0);
        });
    }

    [Fact]
    public async Task Scheduled_Work_Trigger_Starts_Role_Work_Without_Using_OperationResolved_Wire_Message()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-scheduled-trigger-starts-work");
            var trigger = new ScheduledWorkTriggered(
                "schedule-contract-reminder",
                "occurrence-contract-reminder",
                "contracts.reminder_due",
                "{\"contractId\":\"LEASE-2027\",\"reminderText\":\"Review lease renewal\"}",
                DateTimeOffset.UtcNow.AddMinutes(-1),
                DateTimeOffset.UtcNow);

            var accepted = await actor.Ask<DeliveryAccepted>(
                CreateOffer("delivery-scheduled-trigger", ScheduledWorkTriggered.MessageType, JsonSerializer.Serialize(trigger)),
                TimeSpan.FromSeconds(3));

            Assert.Equal("scheduled_input_recorded", accepted.AcceptanceKind);

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.True(state.PendingOperations.Count >= 1);
            Assert.Contains(state.PendingOperations.Values, x => x.ContractId is "metadata.create" or "schedule.create");
        });
    }

    [Fact]
    public async Task DeliveryTerminalSignal_With_Unknown_DeliveryId_Does_Not_Mutate_State()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-terminal-unknown-delivery-id");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-terminal-unknown-delivery-id"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));

            actor.Tell(CreateTerminalSignal("delivery-unknown", DeliveryStatus.Quarantined, new OperationError("x", "ignored", false)));

            await AssertEventually(async () =>
            {
                var after = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                AssertEquivalentState(before, after);
            });
        });
    }

    [Fact]
    public async Task Accepted_DeliveryTerminalSignal_For_Pending_Operation_Does_Not_Fail_Run()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-terminal-accepted-pending");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-terminal-accepted-pending"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(before.PendingOperations.Values);

            actor.Tell(CreateTerminalSignal($"delivery-{pending.OperationId.Value}", DeliveryStatus.Accepted, null));

            await AssertEventually(async () =>
            {
                var after = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Contains(after.PendingOperations.Values, x => x.OperationId == pending.OperationId);
                Assert.Equal(before.Status, after.Status);
                Assert.Equal(before.ActiveRuns.Count, after.ActiveRuns.Count);
            });
        });
    }

    [Fact]
    public async Task Timeout_Due_For_Unknown_Operation_Does_Not_Mutate_State()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase21-timeoutdue-unknown");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-timeoutdue-unknown"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));

            actor.Tell(CreateTimeoutDue(new OperationId("op-unknown"), DateTimeOffset.UtcNow.AddMilliseconds(-1)));

            await AssertEventually(async () =>
            {
                var after = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                AssertEquivalentState(before, after);
            });
        });
    }

    [Fact]
    public async Task Timeout_Due_For_NoTimeout_Operation_Does_Not_Mutate_Or_Fail_State()
    {
        await WithSystem(async (system, _) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new AcceptWithoutReplyRecipientActor(system.DeadLetters)), "phase21-no-timeout-recipient");
            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                "phase21-timeoutdue-no-timeout",
                new RoleAgentOperationWatchdogOptions(
                    DefaultTimeout: null,
                    TargetKindTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase) { ["llm"] = null },
                    ContractIdTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase),
                    TimeoutRetryable: true),
                new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase) { ["llm"] = recipient });

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-timeoutdue-no-timeout"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(before.PendingOperations.Values);

            actor.Tell(CreateTimeoutDue(pending.OperationId, DateTimeOffset.UtcNow.AddMilliseconds(-1)));

            await AssertEventually(async () =>
            {
                var after = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Contains(after.PendingOperations.Values, x => x.OperationId == pending.OperationId);
                Assert.Equal(before.Status, after.Status);
            });
        });
    }

    [Fact]
    public async Task Timeout_Due_Prematurely_Does_Not_Fail_State()
    {
        await WithSystem(async (system, _) =>
        {
            var observingRecipient = system.ActorOf(Props.Create(() => new AcceptWithoutReplyRecipientActor(system.DeadLetters)), "phase21-premature-timeout-acceptor");

            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                "phase21-timeoutdue-premature",
                CreateWatchdogOptions(TimeSpan.FromSeconds(5)),
                new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase) { ["llm"] = observingRecipient },
                actorNameOverride: "phase21-timeoutdue-premature-actor");

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-timeoutdue-premature"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(before.PendingOperations.Values);

            actor.Tell(CreateTimeoutDue(pending.OperationId, DateTimeOffset.UtcNow.AddSeconds(5)));

            await Task.Delay(150);
            var after = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Contains(after.PendingOperations.Values, x => x.OperationId == pending.OperationId);
            Assert.Equal(before.Status, after.Status);
        });
    }

    [Fact]
    public async Task Unknown_Custom_Role_With_No_Handler_Is_Rejected_Deterministically()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = system.ActorOf(
                Props.Create(() => new RoleAgentActor(
                    "phase21-unknown-role-blocked",
                    new RoleAgentId("agent-custom-1"),
                    new RoleDescriptor("custom_role", "Custom Role"),
                    "Handle custom input")),
                "phase21-unknown-role-blocked");

            var payload = JsonSerializer.Serialize(CreateCommittedWorkItem("claim-custom-role", new RoleAgentId("agent-custom-1"), commandType: "custom.ingest_document"));
            var rejected = await actor.Ask<DeliveryRejected>(CreateOffer("delivery-custom-role", CommittedWorkItem.MessageType, payload), TimeSpan.FromSeconds(3));

            Assert.Equal("unsupported_committed_input_command", rejected.Error.Code);
            await AssertStateBounded(actor, RoleAgentStatus.Created, open: 0, active: 0, pending: 0);
        });
    }

    [Theory]
    [InlineData("completed")]
    [InlineData("failed")]
    [InlineData("blocked")]
    public async Task Terminal_Branches_Keep_Actor_State_Bounded(string terminalKind)
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, $"phase21-bounded-{terminalKind}");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer($"claim-bounded-{terminalKind}"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var llm = Assert.Single(state.PendingOperations.Values);

            switch (terminalKind)
            {
                case "completed":
                    state = await actor.Ask<RoleAgentState>(Resolved(llm, ContractExtractionJson()), TimeSpan.FromSeconds(3));
                    foreach (var pending in state.PendingOperations.Values.OrderBy(x => x.ContractId).ToArray())
                    {
                        var replyJson = pending.ContractId == "schedule.create"
                            ? "{\"scheduleId\":\"schedule-contract-LEASE-2027\"}"
                            : "{\"recordId\":\"record-1\"}";
                        state = await actor.Ask<RoleAgentState>(Resolved(pending, replyJson), TimeSpan.FromSeconds(3));
                    }
                    break;
                case "failed":
                    state = await actor.Ask<RoleAgentState>(Failed(llm, "llm_failed", "non-retryable failure", retryable: false), TimeSpan.FromSeconds(3));
                    break;
                case "blocked":
                    state = await actor.Ask<RoleAgentState>(Failed(llm, "llm_failed", "retryable failure", retryable: true), TimeSpan.FromSeconds(3));
                    break;
            }

            await AssertEventually(async () =>
            {
                var after = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Empty(after.ActiveRuns);
                Assert.Empty(after.PendingOperations);
                Assert.True(after.OpenWorkItems.Count is 0 or 1);
            });
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        return Task.CompletedTask;
    }

    private async Task WithSystem(Func<ActorSystem, RoleAgentLedgerStore, Task> action)
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
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase21-{Guid.NewGuid():N}", config);
        var ledger = new RoleAgentLedgerStore($"Data Source={_databasePath}");
        _ = system.ActorOf(Props.Create(() => new RoleAgentLedgerProjectionActor(ledger)), $"phase21-ledger-projection-{Guid.NewGuid():N}");
        try
        {
            await action(system, ledger);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static IActorRef CreateContractWatcherAgent(ActorSystem system, string persistenceId) =>
        system.ActorOf(
            Props.Create(() => new RoleAgentActor(
                persistenceId,
                new RoleAgentId("agent-contract-1"),
                new RoleDescriptor("contract_watcher", "Contract Watcher"),
                "Track contract renewals")),
            persistenceId.Replace('/', '-'));

    private static IActorRef CreateContractWatcherAgentWithWatchdog(
        ActorSystem system,
        string persistenceId,
        RoleAgentOperationWatchdogOptions watchdogOptions,
        IReadOnlyDictionary<string, IActorRef>? recipients = null,
        string? actorNameOverride = null)
    {
        var resolver = new LocalActorAddressRegistry();
        var recipientAddresses = new Dictionary<string, ActorAddress>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in recipients ?? new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase))
        {
            var address = new ActorAddress($"resource/{pair.Key}", "local");
            resolver.Register(address, pair.Value);
            recipientAddresses[pair.Key] = address;
        }

        return system.ActorOf(
            Props.Create(() => new RoleAgentActor(
                persistenceId,
                new RoleAgentId("agent-contract-1"),
                new RoleDescriptor("contract_watcher", "Contract Watcher"),
                "Track contract renewals",
                resolver,
                recipientAddresses,
                watchdogOptions)),
            actorNameOverride ?? persistenceId.Replace('/', '-'));
    }

    private static DeliveryAttemptOffer CreateCommittedOffer(string claimId, string incomingItemRef = "lease-2027.pdf")
    {
        var committed = CreateCommittedWorkItem(claimId, new RoleAgentId("agent-contract-1"), incomingItemRef);
        return CreateOffer($"delivery-{claimId}", CommittedWorkItem.MessageType, JsonSerializer.Serialize(committed));
    }

    private static CommittedWorkItem CreateCommittedWorkItem(
        string claimId,
        RoleAgentId roleAgentId,
        string incomingItemRef = "lease-2027.pdf",
        string commandType = "contracts.ingest_document")
    {
        var command = new ContractWatcherDocumentCommand(
            new RoutingAttemptId($"route-{claimId}"),
            new WorkOfferId($"offer-{claimId}"),
            new WorkClaimId(claimId),
            roleAgentId,
            incomingItemRef,
            Array.Empty<string>(),
            "lease renewal packet",
            "contracts.renewal",
            "router proposal",
            [new SchemaRef("schema://contracts/contract-summary@1")],
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"));

        return new CommittedWorkItem(
            new WorkClaimId(claimId),
            new RoutingAttemptId($"route-{claimId}"),
            roleAgentId,
            incomingItemRef,
            Array.Empty<string>(),
            "lease renewal packet",
            commandType,
            JsonSerializer.Serialize(command),
            "contracts",
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"),
            "contracts.renewal",
            "router proposal");
    }

    private static DeliveryAttemptOffer CreateOffer(string deliveryId, string messageType, string payload)
    {
        var envelope = new AvenEnvelope<string>(
            new CommandId($"cmd-{deliveryId}"),
            new MessageId($"msg-{deliveryId}"),
            new ActorAddress("intake/a", "local"),
            new ActorAddress("agent/agent-contract-1", "local"),
            new ActorAddress("intake/a", "local"),
            new CorrelationId($"corr-{deliveryId}"),
            messageType,
            1,
            payload,
            null,
            null,
            DateTimeOffset.UtcNow);

        return new DeliveryAttemptOffer(new DeliveryId(deliveryId), envelope, PersistedCommandPayload.FromInlineJson(payload).Hash);
    }

    private static DeliveryTerminalSignal CreateTerminalSignal(string deliveryId, DeliveryStatus status, OperationError? error) =>
        new(
            new DeliveryId(deliveryId),
            new DeliveryState(
                new DeliveryId(deliveryId),
                new ActorAddress("agent/agent-contract-1", "local"),
                string.Empty,
                new ActorAddress("resource/llm", "local"),
                new CommandId($"cmd-{deliveryId}"),
                "payload-hash",
                status,
                1,
                null,
                null,
                error));

    private static object CreateTimeoutDue(OperationId operationId, DateTimeOffset deadline)
    {
        var type = typeof(RoleAgentActor).GetNestedType("OperationTimeoutDue", BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("OperationTimeoutDue nested type not found.");
        return Activator.CreateInstance(type, operationId, deadline)
            ?? throw new InvalidOperationException("Could not create OperationTimeoutDue instance.");
    }

    private static OperationResolved Resolved(PendingOperationState pending, string valueJson) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}/worker", "local"),
            new OperationValue(pending.ContractId, valueJson));

    private static OperationFailedReply Failed(PendingOperationState pending, string code, string message, bool retryable) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}/worker", "local"),
            new OperationError(code, message, retryable));

    private static OperationRejected Rejected(PendingOperationState pending, string code, string message, bool retryable) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new OperationError(code, message, retryable));

    private static OperationTimedOutReply TimedOut(PendingOperationState pending, string code, string message, bool retryable) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}/worker", "local"),
            new OperationError(code, message, retryable));

    private static OperationCancelledReply Cancelled(PendingOperationState pending) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"));

    private static string ContractExtractionJson() =>
        "{\"structuredJson\":{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"2030-01-01T00:00:00Z\",\"reminderText\":\"Review lease renewal\",\"renewalTermJson\":{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"2030-01-01T00:00:00Z\"}}}";

    private static async Task AssertEventually(Func<Task> assertion, int attempts = 40, int delayMs = 75)
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

    private static async Task AssertStateBounded(IActorRef actor, RoleAgentStatus status, int open, int active, int pending)
    {
        var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
        Assert.Equal(status, state.Status);
        Assert.Equal(open, state.OpenWorkItems.Count);
        Assert.Equal(active, state.ActiveRuns.Count);
        Assert.Equal(pending, state.PendingOperations.Count);
    }

    private static void AssertEquivalentState(RoleAgentState expected, RoleAgentState actual)
    {
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.LastRunSummary, actual.LastRunSummary);
        Assert.Equal(expected.OpenWorkItems.Keys.OrderBy(x => x.Value), actual.OpenWorkItems.Keys.OrderBy(x => x.Value));
        Assert.Equal(expected.ActiveRuns.Keys.OrderBy(x => x.Value), actual.ActiveRuns.Keys.OrderBy(x => x.Value));
        Assert.Equal(expected.PendingOperations.Keys.OrderBy(x => x.Value), actual.PendingOperations.Keys.OrderBy(x => x.Value));
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private static RoleAgentOperationWatchdogOptions CreateWatchdogOptions(TimeSpan timeout) =>
        new(
            DefaultTimeout: null,
            TargetKindTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase)
            {
                ["llm"] = timeout
            },
            ContractIdTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase),
            TimeoutRetryable: true);

    private sealed record GetObservedDelivery;

    private sealed class DeliveryObserverActor : ReceiveActor
    {
        private DeliveryAttemptOffer? _offer;

        public DeliveryObserverActor()
        {
            Receive<DeliveryAttemptOffer>(offer => _offer = offer);
            Receive<GetObservedDelivery>(_ => Sender.Tell(_offer ?? throw new InvalidOperationException("No delivery observed.")));
        }
    }

    private sealed class AcceptWithoutReplyRecipientActor : ReceiveActor
    {
        public AcceptWithoutReplyRecipientActor(IActorRef observer)
        {
            Receive<DeliveryAttemptOffer>(offer =>
            {
                observer.Tell(offer);
                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, "accepted_no_final_reply"));
            });
        }
    }

    private static string GetCurrentSourceFilePath([CallerFilePath] string callerFilePath = "") => callerFilePath;
}