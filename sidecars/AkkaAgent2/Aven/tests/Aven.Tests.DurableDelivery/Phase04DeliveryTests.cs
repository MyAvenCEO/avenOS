using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.DurableDelivery;
using Aven.Contracts.Protocol.Envelopes;

namespace Aven.Tests.Delivery;

public sealed class Phase04DeliveryTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase04-{Guid.NewGuid():N}.sqlite");

    [Fact]
    [Trait("Category", "FoundationActor")]
    public async Task Delivery_launcher_creates_sender_owned_child_with_deterministic_name_and_persistence_id()
    {
        var recipientAddress = new ActorAddress("actors/supervised-recipient", "local");
        var envelope = CreateEnvelope("cmd-supervised", recipientAddress);
        var spec = new DurableDeliverySpec(
            new DeliveryId("del-supervised"),
            envelope.Sender,
            envelope,
            new DeliveryPolicy(TimeSpan.FromMilliseconds(100), 10));

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new AcceptingRecipientActor(recipientAddress)), "supervised-recipient");
            resolver.Register(recipientAddress, recipient);
            var owner = system.ActorOf(Props.Create(() => new DurableDeliveryFactoryOwnerActor("delivery-owner", resolver)), "delivery-owner");
            var result = await owner.Ask<DurableDeliveryFactoryResult>(new StartDeliveryViaLauncher(spec), TimeSpan.FromSeconds(3));

            Assert.False(result.Child.IsNobody());
            Assert.Equal(DurableDeliveryFactory.ChildName(spec.DeliveryId), result.Child.Path.Name);
            Assert.Equal(DurableDeliveryFactory.PersistenceId("delivery-owner", spec.DeliveryId), result.PersistenceId);

            return true;
        });
    }

    [Fact]
    [Trait("Category", "FoundationActor")]
    public async Task Delivery_launcher_reuses_same_child_for_same_delivery_id()
    {
        var recipientAddress = new ActorAddress("actors/recover-created-recipient", "local");
        var envelope = CreateEnvelope("cmd-recover-created", recipientAddress);
        var spec = new DurableDeliverySpec(
            new DeliveryId("del-recover-created"),
            envelope.Sender,
            envelope,
            new DeliveryPolicy(TimeSpan.FromMilliseconds(100), 10));

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new AcceptingRecipientActor(recipientAddress)), "recover-created-recipient");
            resolver.Register(recipientAddress, recipient);
            var owner = system.ActorOf(Props.Create(() => new DurableDeliveryFactoryOwnerActor("delivery-owner-reuse", resolver)), "delivery-owner-reuse");
            var first = await owner.Ask<DurableDeliveryFactoryResult>(new StartDeliveryViaLauncher(spec, Start: false), TimeSpan.FromSeconds(3));
            var second = await owner.Ask<DurableDeliveryFactoryResult>(new StartDeliveryViaLauncher(spec), TimeSpan.FromSeconds(3));

            Assert.Equal(first.Child.Path, second.Child.Path);
            await AssertEventually(async () =>
            {
                var deliveryState = await second.Child.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, deliveryState.Status);
            });

            return true;
        });
    }

    [Fact]
    [Trait("Category", "FoundationActor")]
    public void DurableDeliveryStartFactory_ValidatesRequiredFields()
    {
        var envelope = AvenEnvelopeBuilder
            .ForMessage("tests.message", "{\"ok\":true}")
            .From(new ActorAddress("sender/1", "local"))
            .To(new ActorAddress("recipient/1", "local"))
            .ReplyTo(new ActorAddress("reply/1", "local"))
            .WithCorrelation(new CorrelationId("corr-001"))
            .WithCommandId(new CommandId("cmd-001"))
            .WithMessageId(new MessageId("msg-001"))
            .WithCreatedAt(DateTimeOffset.UtcNow)
            .Build();

        Assert.Throws<InvalidOperationException>(() => DurableDeliveryStartFactory.ForEnvelope(envelope)
            .WithDeliveryId(new DeliveryId("del-001"))
            .WithPolicy(new DeliveryPolicy(TimeSpan.FromMilliseconds(100), 3))
            .Build());

        Assert.Throws<InvalidOperationException>(() => DurableDeliveryStartFactory.ForEnvelope(envelope)
            .OwnedBy(new ActorAddress("owner/1", "local"))
            .WithPolicy(new DeliveryPolicy(TimeSpan.FromMilliseconds(100), 3))
            .Build());

        Assert.Throws<InvalidOperationException>(() => DurableDeliveryStartFactory.ForEnvelope(envelope)
            .OwnedBy(new ActorAddress("owner/1", "local"))
            .WithDeliveryId(new DeliveryId("del-001"))
            .Build());
    }

    [Fact]
    public async Task RecipientUnavailable_Retries_NoPermanentFailure()
    {
        await WithSystem(async (system, resolver) =>
        {
            var envelope = CreateEnvelope("cmd-unresolved", new ActorAddress("actors/missing", "local"));
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-unresolved", new DeliveryId("del-unresolved"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-unresolved");

            actor.Tell(new DeliveryStart(new DeliveryId("del-unresolved")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Sending, state.Status);
                Assert.True(state.Attempts >= 2);
                Assert.Null(state.AcceptedAt);
            });

            return true;
        });
    }

    [Fact]
    public async Task RecipientAcceptsDurably_DeliveryTerminalAccepted()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-a", "local");
            var recipient = system.ActorOf(Props.Create(() => new AcceptingRecipientActor(recipientAddress)), "recipient-a");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-accepted", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-accepted", new DeliveryId("del-accepted"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-accepted");

            actor.Tell(new DeliveryStart(new DeliveryId("del-accepted")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, state.Status);
                Assert.NotNull(state.AcceptedAt);
            });

            return true;
        });
    }

    [Fact]
    public async Task DeliveryAttemptStarted_IsPersistedBeforeRecipientCanObserveOffer()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-ordering", "local");
            var envelope = CreateEnvelope("cmd-ordering", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-ordering", new DeliveryId("del-ordering"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-ordering");
            var recipient = system.ActorOf(Props.Create(() => new OrderingAssertingRecipientActor(recipientAddress, actor)), "recipient-ordering");
            resolver.Register(recipientAddress, recipient);

            actor.Tell(new DeliveryStart(new DeliveryId("del-ordering")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, state.Status);
            });

            var observedStateBeforeAcceptance = await recipient.Ask<ObservedDeliveryStateBeforeAcceptance>(new GetObservedStateBeforeAcceptance(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Sending, observedStateBeforeAcceptance.Status);
            Assert.True(observedStateBeforeAcceptance.Attempts >= 1);
            Assert.True(observedStateBeforeAcceptance.SawAttemptEventBeforeOffer);
            return true;
        });
    }

    [Fact]
    public async Task RecipientUnavailable_PersistsUnresolvedAttempt_AndRetries()
    {
        await WithSystem(async (system, resolver) =>
        {
            var probe = system.ActorOf(Props.Create(() => new DeliveryAttemptProbeActor()), "unresolved-attempt-probe");
            var envelope = CreateEnvelope("cmd-unresolved-persisted", new ActorAddress("actors/missing-persisted", "local"));
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-unresolved-persisted", new DeliveryId("del-unresolved-persisted"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(50))), "delivery-unresolved-persisted");

            actor.Tell(new DeliveryStart(new DeliveryId("del-unresolved-persisted")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Sending, state.Status);
                Assert.True(state.Attempts >= 2);

                var attempts = await probe.Ask<DeliveryAttemptStarted[]>(new GetDeliveryAttemptEvents(), TimeSpan.FromSeconds(3));
                Assert.Contains(attempts, attempt =>
                    attempt.DeliveryId == new DeliveryId("del-unresolved-persisted")
                    && attempt.Result == DeliveryAttemptResult.RecipientUnresolved);
            });

            return true;
        });
    }

    [Fact]
    public async Task RecipientRejectsDurably_DeliveryTerminalRejected()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-reject", "local");
            var recipient = system.ActorOf(Props.Create(() => new RejectingRecipientActor(recipientAddress)), "recipient-reject");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-rejected", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-rejected", new DeliveryId("del-rejected"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-rejected");

            actor.Tell(new DeliveryStart(new DeliveryId("del-rejected")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Rejected, state.Status);
                Assert.NotNull(state.TerminalError);
                Assert.Equal("recipient_rejected", state.TerminalError!.Code);
            });

            return true;
        });
    }

    [Fact]
    public async Task RetryableRecipientRejection_RetriesUntilAccepted_WithoutTerminalRejection()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-retryable-then-accept", "local");
            var terminalAddress = new ActorAddress("actors/retryable-then-accept-terminal", "local");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "retryable-then-accept-terminal");
            resolver.Register(terminalAddress, terminalProbe);

            var recipient = system.ActorOf(Props.Create(() => new RetryableRejectThenAcceptRecipientActor(recipientAddress, rejectCount: 1)), "recipient-retryable-then-accept");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-retryable-then-accept", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-retryable-then-accept",
                    new DeliveryId("del-retryable-then-accept"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(50),
                    5,
                    null,
                    terminalAddress)), "delivery-retryable-then-accept");

            actor.Tell(new DeliveryStart(new DeliveryId("del-retryable-then-accept")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, state.Status);
                Assert.True(state.Attempts >= 2);
                Assert.Null(state.TerminalError);
            });

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(new DeliveryId("del-retryable-then-accept"), terminal.DeliveryId);
            Assert.Equal(DeliveryStatus.Accepted, terminal.State.Status);
            Assert.Null(terminal.State.TerminalError);

            return true;
        });
    }

    [Fact]
    public async Task RetryableRecipientRejection_QuarantinesAfterRetryBudget()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-retryable-always", "local");
            var terminalAddress = new ActorAddress("actors/retryable-always-terminal", "local");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "retryable-always-terminal");
            resolver.Register(terminalAddress, terminalProbe);

            var recipient = system.ActorOf(Props.Create(() => new AlwaysRetryableRejectingRecipientActor(recipientAddress)), "recipient-retryable-always");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-retryable-quarantine", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-retryable-quarantine",
                    new DeliveryId("del-retryable-quarantine"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(50),
                    3,
                    null,
                    terminalAddress)), "delivery-retryable-quarantine");

            actor.Tell(new DeliveryStart(new DeliveryId("del-retryable-quarantine")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Quarantined, state.Status);
                Assert.Equal(3, state.Attempts);
                Assert.NotNull(state.TerminalError);
                Assert.Equal("delivery_retry_exhausted", state.TerminalError!.Code);
            });

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(new DeliveryId("del-retryable-quarantine"), terminal.DeliveryId);
            Assert.Equal(DeliveryStatus.Quarantined, terminal.State.Status);
            Assert.Equal("delivery_retry_exhausted", terminal.State.TerminalError!.Code);

            return true;
        });
    }

    [Fact]
    public async Task NonRetryableRecipientRejection_RemainsTerminalRejected()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-nonretryable-terminal", "local");
            var terminalAddress = new ActorAddress("actors/nonretryable-terminal-probe", "local");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "nonretryable-terminal-probe");
            resolver.Register(terminalAddress, terminalProbe);

            var recipient = system.ActorOf(Props.Create(() => new RejectingRecipientActor(recipientAddress)), "recipient-nonretryable-terminal");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-nonretryable-terminal", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-nonretryable-terminal",
                    new DeliveryId("del-nonretryable-terminal"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(50),
                    5,
                    null,
                    terminalAddress)), "delivery-nonretryable-terminal");

            actor.Tell(new DeliveryStart(new DeliveryId("del-nonretryable-terminal")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Rejected, state.Status);
                Assert.NotNull(state.TerminalError);
                Assert.Equal("recipient_rejected", state.TerminalError!.Code);
            });

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Rejected, terminal.State.Status);
            Assert.Equal("recipient_rejected", terminal.State.TerminalError!.Code);

            return true;
        });
    }

    [Fact]
    public async Task RestartBeforeAcceptance_DeliveryResumes()
    {
        var recipientAddress = new ActorAddress("actors/recipient-restart", "local");
        var envelope = CreateEnvelope("cmd-restart", recipientAddress);

        await WithSystem(async (system, resolver) =>
        {
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-restart", new DeliveryId("del-restart"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-restart");
            actor.Tell(new DeliveryStart(new DeliveryId("del-restart")));
            await Task.Delay(250);
            var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.True(state.Attempts >= 1);
            Assert.Equal(DeliveryStatus.Sending, state.Status);
            return true;
        });

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new AcceptingRecipientActor(recipientAddress)), "recipient-restart");
            resolver.Register(recipientAddress, recipient);

            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-restart", new DeliveryId("del-restart"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-restart");

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, state.Status);
                Assert.True(state.Attempts >= 1);
            });

            return true;
        });
    }

    [Fact]
    public async Task RecoveryAfterPersistedAttemptBeforeAcceptance_RetriesAndCanAccept()
    {
        var recipientAddress = new ActorAddress("actors/recipient-retry-after-persist", "local");
        var envelope = CreateEnvelope("cmd-retry-after-persist", recipientAddress);

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new NonAcknowledgingRecipientActor()), "recipient-retry-after-persist-a");
            resolver.Register(recipientAddress, recipient);

            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-retry-after-persist", new DeliveryId("del-retry-after-persist"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-retry-after-persist");
            actor.Tell(new DeliveryStart(new DeliveryId("del-retry-after-persist")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Sending, state.Status);
                Assert.True(state.Attempts >= 1);
            });

            return true;
        });

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new AcceptingRecipientActor(recipientAddress)), "recipient-retry-after-persist-b");
            resolver.Register(recipientAddress, recipient);

            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-retry-after-persist", new DeliveryId("del-retry-after-persist"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(50))), "delivery-retry-after-persist");

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, state.Status);
                Assert.True(state.Attempts >= 2);
            });

            return true;
        });
    }

    [Fact]
    public async Task DuplicateDeliveryToRecipient_IsDeduped()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-dup", "local");
            var recipient = system.ActorOf(Props.Create(() => new AcceptingRecipientActor(recipientAddress)), "recipient-dup");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-dup", recipientAddress);
            var actorA = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-dup-a", new DeliveryId("del-dup-a"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-dup-a");
            var actorB = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-dup-b", new DeliveryId("del-dup-b"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-dup-b");

            actorA.Tell(new DeliveryStart(new DeliveryId("del-dup-a")));
            actorB.Tell(new DeliveryStart(new DeliveryId("del-dup-b")));

            await AssertEventually(async () =>
            {
                var stateA = await actorA.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                var stateB = await actorB.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, stateA.Status);
                Assert.Equal(DeliveryStatus.Accepted, stateB.Status);
            });

            var acceptCount = await recipient.Ask<int>(new GetAcceptedCommandCount(), TimeSpan.FromSeconds(3));
            Assert.Equal(1, acceptCount);
            return true;
        });
    }

    [Fact]
    public async Task TellCalled_IsNotTreatedAsAcceptance()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-noack", "local");
            var recipient = system.ActorOf(Props.Create(() => new NonAcknowledgingRecipientActor()), "recipient-noack");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-noack", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-noack", new DeliveryId("del-noack"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(100))), "delivery-noack");

            actor.Tell(new DeliveryStart(new DeliveryId("del-noack")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Sending, state.Status);
                Assert.Null(state.AcceptedAt);
                Assert.True(state.Attempts >= 2);
            });

            return true;
        });
    }

    [Fact]
    public async Task RecipientUnavailable_StopsAfterRetryBudget_AndQuarantines()
    {
        await WithSystem(async (system, resolver) =>
        {
            var envelope = CreateEnvelope("cmd-quarantine", new ActorAddress("actors/missing-quarantine", "local"));
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-quarantine", new DeliveryId("del-quarantine"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(50), maxAttempts: 3)), "delivery-quarantine");

            actor.Tell(new DeliveryStart(new DeliveryId("del-quarantine")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Quarantined, state.Status);
                Assert.Equal(3, state.Attempts);
                Assert.NotNull(state.TerminalError);
                Assert.Equal("delivery_retry_exhausted", state.TerminalError!.Code);
            });

            return true;
        });
    }

    [Fact]
    public async Task RecipientUnavailable_Quarantine_NotifiesTerminalTarget()
    {
        await WithSystem(async (system, resolver) =>
        {
            var terminalAddress = new ActorAddress("actors/quarantine-terminal-probe", "local");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "quarantine-terminal-probe");
            resolver.Register(terminalAddress, terminalProbe);

            var envelope = CreateEnvelope("cmd-quarantine-terminal", new ActorAddress("actors/missing-quarantine-terminal", "local"));
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-quarantine-terminal",
                    new DeliveryId("del-quarantine-terminal"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(50),
                    3,
                    null,
                    terminalAddress)), "delivery-quarantine-terminal");

            actor.Tell(new DeliveryStart(new DeliveryId("del-quarantine-terminal")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Quarantined, state.Status);
            });

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(new DeliveryId("del-quarantine-terminal"), terminal.DeliveryId);
            Assert.Equal(DeliveryStatus.Quarantined, terminal.State.Status);
            Assert.NotNull(terminal.State.TerminalError);
            Assert.Equal("delivery_retry_exhausted", terminal.State.TerminalError!.Code);

            return true;
        });
    }

    [Fact]
    public async Task DeliveryCancel_TerminatesDelivery_NotifiesTerminalTarget_AndStopsRetries()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/cancel-missing", "local");
            var terminalAddress = new ActorAddress("actors/terminal-probe", "local");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "terminal-probe");
            resolver.Register(terminalAddress, terminalProbe);

            var envelope = CreateEnvelope("cmd-cancel", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor("delivery-cancel", new DeliveryId("del-cancel"), envelope.Sender, envelope, PayloadHash(envelope), resolver, TimeSpan.FromMilliseconds(50), 10, null, terminalAddress)), "delivery-cancel");

            actor.Tell(new DeliveryStart(new DeliveryId("del-cancel")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.True(state.Attempts >= 1);
                Assert.Equal(DeliveryStatus.Sending, state.Status);
            });

            actor.Tell(new DeliveryCancel(new DeliveryId("del-cancel"), "user cancelled"));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Cancelled, state.Status);
                Assert.NotNull(state.TerminalError);
                Assert.Equal("delivery_cancelled", state.TerminalError!.Code);
            });

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Cancelled, terminal.State.Status);

            var attemptsAfterCancel = (await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3))).Attempts;
            await Task.Delay(200);
            var finalState = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(attemptsAfterCancel, finalState.Attempts);

            return true;
        });
    }

    [Fact]
    public async Task ExpiredBeforeStart_DeliveryExpiresWithoutAttemptingRecipient()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-expired-before-start", "local");
            var terminalAddress = new ActorAddress("actors/expired-before-start-terminal", "local");
            var recipient = system.ActorOf(Props.Create(() => new CountingAcceptingRecipientActor(recipientAddress)), "recipient-expired-before-start");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "expired-before-start-terminal");
            resolver.Register(recipientAddress, recipient);
            resolver.Register(terminalAddress, terminalProbe);

            var envelope = CreateEnvelope("cmd-expired-before-start", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-expired-before-start",
                    new DeliveryId("del-expired-before-start"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(100),
                    5,
                    DateTimeOffset.UtcNow.AddMilliseconds(-100),
                    terminalAddress)), "delivery-expired-before-start");

            actor.Tell(new DeliveryStart(new DeliveryId("del-expired-before-start")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
                Assert.Equal(0, state.Attempts);
                Assert.NotNull(state.TerminalError);
                Assert.Equal("delivery_expired", state.TerminalError!.Code);
            });

            var offers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
            Assert.Equal(0, offers);

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Expired, terminal.State.Status);
            Assert.Equal("delivery_expired", terminal.State.TerminalError!.Code);

            return true;
        });
    }

    [Fact]
    public async Task ExpiresBeforeRetry_DeliveryExpiresInsteadOfRetrying()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-expire-before-retry", "local");
            var terminalAddress = new ActorAddress("actors/expire-before-retry-terminal", "local");
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-expire-before-retry");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "expire-before-retry-terminal");
            resolver.Register(recipientAddress, recipient);
            resolver.Register(terminalAddress, terminalProbe);

            var envelope = CreateEnvelope("cmd-expire-before-retry", recipientAddress);
            var expiresAt = DateTimeOffset.UtcNow.AddSeconds(2);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-expire-before-retry",
                    new DeliveryId("del-expire-before-retry"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromSeconds(10),
                    5,
                    expiresAt,
                    terminalAddress)), "delivery-expire-before-retry");

            actor.Tell(new DeliveryStart(new DeliveryId("del-expire-before-retry")));

            var firstOfferObservedAt = DateTimeOffset.MinValue;
            await AssertEventually(async () =>
            {
                var offers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, offers);
                firstOfferObservedAt = DateTimeOffset.UtcNow;
            });

            Assert.True(
                firstOfferObservedAt < expiresAt,
                $"First offer was not observed before expiry deadline. firstOfferObservedAt={firstOfferObservedAt:O}, expiresAt={expiresAt:O}");

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Sending, state.Status);
                Assert.Equal(1, state.Attempts);
            });

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
                Assert.Equal(1, state.Attempts);
                Assert.NotNull(state.TerminalError);
                Assert.Equal("delivery_expired", state.TerminalError!.Code);
            }, attempts: 60, delayMs: 50);

            var finalOffers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
            Assert.Equal(1, finalOffers);

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Expired, terminal.State.Status);

            return true;
        });
    }

    [Fact]
    public async Task AcceptedAfterExpiry_IsIgnoredAndDeliveryStaysExpired()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-late-accept", "local");
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-late-accept");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-late-accept", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-late-accept",
                    new DeliveryId("del-late-accept"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(100),
                    5,
                    DateTimeOffset.UtcNow.AddMilliseconds(50))), "delivery-late-accept");

            actor.Tell(new DeliveryStart(new DeliveryId("del-late-accept")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
            }, attempts: 30, delayMs: 50);

            actor.Tell(new DeliveryAccepted(new DeliveryId("del-late-accept"), envelope.CommandId, recipientAddress, "late_accept"));
            await Task.Delay(150);

            var finalState = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Expired, finalState.Status);
            Assert.Equal("delivery_expired", finalState.TerminalError!.Code);

            return true;
        });
    }

    [Fact]
    public async Task RejectedAfterExpiry_IsIgnoredAndDeliveryStaysExpired()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-late-reject", "local");
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-late-reject");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-late-reject", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-late-reject",
                    new DeliveryId("del-late-reject"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(100),
                    5,
                    DateTimeOffset.UtcNow.AddMilliseconds(50))), "delivery-late-reject");

            actor.Tell(new DeliveryStart(new DeliveryId("del-late-reject")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
            }, attempts: 30, delayMs: 50);

            actor.Tell(new DeliveryRejected(
                new DeliveryId("del-late-reject"),
                envelope.CommandId,
                recipientAddress,
                new OperationError("late_reject", "Late reject after expiry.", false)));
            await Task.Delay(150);

            var finalState = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Expired, finalState.Status);
            Assert.Equal("delivery_expired", finalState.TerminalError!.Code);

            return true;
        });
    }

    [Fact]
    public async Task ExpiredDeliveryRecoversAsTerminalAfterRestart()
    {
        var recipientAddress = new ActorAddress("actors/recipient-expired-recovery", "local");
        var envelope = CreateEnvelope("cmd-expired-recovery", recipientAddress);

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-expired-recovery-a");
            resolver.Register(recipientAddress, recipient);

            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-expired-recovery",
                    new DeliveryId("del-expired-recovery"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(100),
                    5,
                    DateTimeOffset.UtcNow.AddMilliseconds(50))), "delivery-expired-recovery");

            actor.Tell(new DeliveryStart(new DeliveryId("del-expired-recovery")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
                Assert.Equal("delivery_expired", state.TerminalError!.Code);
            }, attempts: 30, delayMs: 50);

            return true;
        });

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-expired-recovery-b");
            resolver.Register(recipientAddress, recipient);

            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-expired-recovery",
                    new DeliveryId("del-expired-recovery"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(100),
                    5,
                    DateTimeOffset.UtcNow.AddMinutes(5))), "delivery-expired-recovery");

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
                Assert.Equal("delivery_expired", state.TerminalError!.Code);
            });

            actor.Tell(new DeliveryStart(new DeliveryId("del-expired-recovery")));
            await Task.Delay(150);

            var finalState = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Expired, finalState.Status);
            Assert.Equal(0, finalState.Attempts);

            var offers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
            Assert.Equal(0, offers);

            return true;
        });
    }

    [Fact]
    public async Task ExpiresAtDeadline_ExpiresWithoutWaitingForRetryDue()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-deadline-expiry", "local");
            var terminalAddress = new ActorAddress("actors/deadline-expiry-terminal", "local");
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-deadline-expiry");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "deadline-expiry-terminal");
            resolver.Register(recipientAddress, recipient);
            resolver.Register(terminalAddress, terminalProbe);

            var envelope = CreateEnvelope("cmd-deadline-expiry", recipientAddress);
            var expiresAt = DateTimeOffset.UtcNow.AddSeconds(2);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-deadline-expiry",
                    new DeliveryId("del-deadline-expiry"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromSeconds(5),
                    5,
                    expiresAt,
                    terminalAddress)), "delivery-deadline-expiry");

            actor.Tell(new DeliveryStart(new DeliveryId("del-deadline-expiry")));

            var firstOfferObservedAt = DateTimeOffset.MinValue;
            await AssertEventually(async () =>
            {
                var offers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, offers);
                firstOfferObservedAt = DateTimeOffset.UtcNow;
            });

            Assert.True(
                firstOfferObservedAt < expiresAt,
                $"First offer was not observed before expiry deadline. firstOfferObservedAt={firstOfferObservedAt:O}, expiresAt={expiresAt:O}");

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
                Assert.Equal(1, state.Attempts);
            }, attempts: 60, delayMs: 50);

            Assert.True(
                DateTimeOffset.UtcNow - expiresAt < TimeSpan.FromSeconds(2),
                $"Expiry was not observed promptly after the deadline. observedAt={DateTimeOffset.UtcNow:O}, expiresAt={expiresAt:O}");

            var finalOffers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
            Assert.Equal(1, finalOffers);

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Expired, terminal.State.Status);

            return true;
        });
    }

    [Fact]
    public async Task RecoveredNonTerminalPastExpiresAt_ExpiresAfterRecoveryWithoutPersistingDuringRecovery()
    {
        var recipientAddress = new ActorAddress("actors/recipient-recovered-past-expiry", "local");
        var terminalAddress = new ActorAddress("actors/recovered-past-expiry-terminal", "local");
        var envelope = CreateEnvelope("cmd-recovered-past-expiry", recipientAddress);
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(2);

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-recovered-past-expiry-a");
            resolver.Register(recipientAddress, recipient);

            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-recovered-past-expiry",
                    new DeliveryId("del-recovered-past-expiry"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromSeconds(5),
                    5,
                    expiresAt,
                    terminalAddress)), "delivery-recovered-past-expiry");

            actor.Tell(new DeliveryStart(new DeliveryId("del-recovered-past-expiry")));

            await AssertEventually(async () =>
            {
                var offers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, offers);

                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Sending, state.Status);
                Assert.Equal(1, state.Attempts);
            });

            return true;
        });

        await Task.Delay(expiresAt - DateTimeOffset.UtcNow + TimeSpan.FromMilliseconds(150));

        await WithSystem(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-recovered-past-expiry-b");
            var terminalProbe = system.ActorOf(Props.Create(() => new TerminalSignalProbeActor()), "recovered-past-expiry-terminal");
            resolver.Register(recipientAddress, recipient);
            resolver.Register(terminalAddress, terminalProbe);

            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-recovered-past-expiry",
                    new DeliveryId("del-recovered-past-expiry"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromSeconds(5),
                    5,
                    expiresAt,
                    terminalAddress)), "delivery-recovered-past-expiry");

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Expired, state.Status);
                Assert.Equal(1, state.Attempts);
                Assert.Equal("delivery_expired", state.TerminalError!.Code);
            }, attempts: 20, delayMs: 50);

            var offers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
            Assert.Equal(0, offers);

            var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetTerminalSignal(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Expired, terminal.State.Status);

            return true;
        });
    }

    [Fact]
    public async Task ExpiryTimer_IsCancelledAfterAccepted()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-expiry-cancelled-after-accept", "local");
            var recipient = system.ActorOf(Props.Create(() => new AcceptingRecipientActor(recipientAddress)), "recipient-expiry-cancelled-after-accept");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-expiry-cancelled-after-accept", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-expiry-cancelled-after-accept",
                    new DeliveryId("del-expiry-cancelled-after-accept"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromMilliseconds(100),
                    5,
                    DateTimeOffset.UtcNow.AddMilliseconds(500))), "delivery-expiry-cancelled-after-accept");

            actor.Tell(new DeliveryStart(new DeliveryId("del-expiry-cancelled-after-accept")));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Accepted, state.Status);
            });

            await Task.Delay(700);

            var finalState = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Accepted, finalState.Status);

            return true;
        });
    }

    [Fact]
    public async Task ExpiryTimer_IsCancelledAfterCancelled()
    {
        await WithSystem(async (system, resolver) =>
        {
            var recipientAddress = new ActorAddress("actors/recipient-expiry-cancelled-after-cancel", "local");
            var recipient = system.ActorOf(Props.Create(() => new CountingNonAcknowledgingRecipientActor()), "recipient-expiry-cancelled-after-cancel");
            resolver.Register(recipientAddress, recipient);

            var envelope = CreateEnvelope("cmd-expiry-cancelled-after-cancel", recipientAddress);
            var actor = system.ActorOf(Props.Create(() =>
                new DurableDeliveryActor(
                    "delivery-expiry-cancelled-after-cancel",
                    new DeliveryId("del-expiry-cancelled-after-cancel"),
                    envelope.Sender,
                    envelope,
                    PayloadHash(envelope),
                    resolver,
                    TimeSpan.FromSeconds(5),
                    5,
                    DateTimeOffset.UtcNow.AddMilliseconds(500))), "delivery-expiry-cancelled-after-cancel");

            actor.Tell(new DeliveryStart(new DeliveryId("del-expiry-cancelled-after-cancel")));

            await AssertEventually(async () =>
            {
                var offers = await recipient.Ask<int>(new GetOfferCount(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, offers);
            });

            actor.Tell(new DeliveryCancel(new DeliveryId("del-expiry-cancelled-after-cancel"), "cancel before expiry"));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(DeliveryStatus.Cancelled, state.Status);
            });

            await Task.Delay(700);

            var finalState = await actor.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Cancelled, finalState.Status);

            return true;
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

    private async Task<T> WithSystem<T>(Func<ActorSystem, LocalActorAddressRegistry, Task<T>> action)
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

        var system = ActorSystem.Create($"aven-phase04-{Guid.NewGuid():N}", config);
        var resolver = new LocalActorAddressRegistry();
        try
        {
            return await action(system, resolver);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static AvenEnvelope<string> CreateEnvelope(string commandId, ActorAddress recipient) => new(
        new CommandId(commandId),
        new MessageId($"msg-{commandId}"),
        new ActorAddress("actors/owner", "local"),
        recipient,
        new ActorAddress("actors/reply", "local"),
        new CorrelationId($"corr-{commandId}"),
        "delivery.test",
        1,
        "payload",
        null,
        null,
        DateTimeOffset.UtcNow);

    private static string PayloadHash(AvenEnvelope<string> envelope) => PersistedCommandPayload.FromInlineJson(envelope.Payload).Hash;

    private static async Task AssertEventually(Func<Task> assertion, int attempts = 20, int delayMs = 100)
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

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private sealed record GetAcceptedCommandCount;
    private sealed record GetOfferCount;
    private sealed record GetObservedStateBeforeAcceptance;
    private sealed record ObservedDeliveryStateBeforeAcceptance(DeliveryStatus Status, int Attempts, bool SawAttemptEventBeforeOffer);
    private sealed record DeliveryStateObservedBeforeAcceptance(DeliveryAttemptOffer Offer, DeliveryState State, IActorRef ReplyTo);
    private sealed record GetDeliveryAttemptEvents;
    private sealed record StartDeliveryViaLauncher(DurableDeliverySpec Spec, bool Start = true);
    private sealed record DurableDeliveryFactoryResult(IActorRef Child, string PersistenceId);

    private sealed class DurableDeliveryFactoryOwnerActor : ReceiveActor
    {
        private readonly string _ownerPersistenceId;
        private readonly DurableDeliveryFactory _launcher;

        public DurableDeliveryFactoryOwnerActor(string ownerPersistenceId, LocalActorAddressRegistry resolver)
        {
            _ownerPersistenceId = ownerPersistenceId;
            _launcher = new DurableDeliveryFactory(resolver);
            Receive<StartDeliveryViaLauncher>(command =>
            {
                var child = _launcher.StartOrResume(Context, _ownerPersistenceId, command.Spec, command.Start);
                Sender.Tell(new DurableDeliveryFactoryResult(child, DurableDeliveryFactory.PersistenceId(_ownerPersistenceId, command.Spec.DeliveryId)));
            });
        }
    }

    private sealed class DeliveryAttemptProbeActor : ReceiveActor
    {
        private readonly List<DeliveryAttemptStarted> _attempts = new();

        public DeliveryAttemptProbeActor()
        {
            Receive<GetDeliveryAttemptEvents>(_ => Sender.Tell(_attempts.ToArray()));
            Receive<object>(message =>
            {
                if (message.GetType().IsGenericType
                    && message.GetType().GetGenericTypeDefinition() == typeof(AvenEventEnvelope<>))
                {
                    var data = message.GetType().GetProperty(nameof(AvenEventEnvelope<Aven.Events.Interfaces.IAvenEvent>.Data))!.GetValue(message);
                    if (data is DeliveryAttemptStarted attempt)
                    {
                        _attempts.Add(attempt);
                    }
                }
            });
        }

        protected override void PreStart() => Context.System.EventStream.Subscribe(Self, typeof(object));
        protected override void PostStop() => Context.System.EventStream.Unsubscribe(Self);
    }

    private sealed class NonAcknowledgingRecipientActor : ReceiveActor
    {
        public NonAcknowledgingRecipientActor()
        {
            Receive<DeliveryAttemptOffer>(_ => { });
        }
    }

    private sealed class CountingNonAcknowledgingRecipientActor : ReceiveActor
    {
        private int _offers;

        public CountingNonAcknowledgingRecipientActor()
        {
            Receive<DeliveryAttemptOffer>(_ => _offers++);
            Receive<GetOfferCount>(_ => Sender.Tell(_offers));
        }
    }

    private sealed class OrderingAssertingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private readonly IActorRef _deliveryActor;
        private bool _sawAttemptBeforeOffer;
        private ObservedDeliveryStateBeforeAcceptance? _observedBeforeAcceptance;

        public OrderingAssertingRecipientActor(ActorAddress address, IActorRef deliveryActor)
        {
            _address = address;
            _deliveryActor = deliveryActor;
            Receive<GetObservedStateBeforeAcceptance>(_ => Sender.Tell(_observedBeforeAcceptance ?? new ObservedDeliveryStateBeforeAcceptance(DeliveryStatus.Created, 0, false)));
            Receive<DeliveryStateObservedBeforeAcceptance>(observed =>
            {
                _observedBeforeAcceptance = new ObservedDeliveryStateBeforeAcceptance(
                    observed.State.Status,
                    observed.State.Attempts,
                    _sawAttemptBeforeOffer);
                observed.ReplyTo.Tell(new DeliveryAccepted(observed.Offer.DeliveryId, observed.Offer.Envelope.CommandId, _address, "accepted"));
            });
            Receive<object>(message =>
            {
                if (message is DeliveryAttemptOffer offer)
                {
                    var replyTo = Sender;
                    _deliveryActor
                        .Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3))
                        .PipeTo(Self, success: state => new DeliveryStateObservedBeforeAcceptance(offer, state, replyTo));
                    return;
                }

                if (message.GetType().IsGenericType
                    && message.GetType().GetGenericTypeDefinition() == typeof(AvenEventEnvelope<>))
                {
                    var data = message.GetType().GetProperty(nameof(AvenEventEnvelope<Aven.Events.Interfaces.IAvenEvent>.Data))!.GetValue(message);
                    if (data is DeliveryAttemptStarted { DeliveryId: var deliveryId, Result: DeliveryAttemptResult.TellPlanned }
                        && deliveryId == new DeliveryId("del-ordering"))
                    {
                        _sawAttemptBeforeOffer = true;
                    }
                }
            });
        }

        protected override void PreStart() => Context.System.EventStream.Subscribe(Self, typeof(object));
        protected override void PostStop() => Context.System.EventStream.Unsubscribe(Self);
    }

    private sealed class RejectingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;

        public RejectingRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer => Sender.Tell(new DeliveryRejected(
                offer.DeliveryId,
                offer.Envelope.CommandId,
                _address,
                new OperationError("recipient_rejected", "Recipient rejected the delivery.", false))));
        }
    }

    private sealed class RetryableRejectThenAcceptRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private readonly int _rejectCount;
        private int _offersSeen;

        public RetryableRejectThenAcceptRecipientActor(ActorAddress address, int rejectCount)
        {
            _address = address;
            _rejectCount = rejectCount;
            Receive<DeliveryAttemptOffer>(offer =>
            {
                _offersSeen++;
                if (_offersSeen <= _rejectCount)
                {
                    Sender.Tell(new DeliveryRejected(
                        offer.DeliveryId,
                        offer.Envelope.CommandId,
                        _address,
                        new OperationError("temporary_not_ready", "Recipient is temporarily not ready.", true)));
                    return;
                }

                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted_after_retryable_rejection"));
            });
        }
    }

    private sealed class AlwaysRetryableRejectingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;

        public AlwaysRetryableRejectingRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer => Sender.Tell(new DeliveryRejected(
                offer.DeliveryId,
                offer.Envelope.CommandId,
                _address,
                new OperationError("temporary_not_ready", "Recipient is temporarily not ready.", true))));
        }
    }

    private sealed class AcceptingRecipientActor : Aven.ActorKernel.Actors.InboxLedgerPersistentActor
    {
        private readonly ActorAddress _address;

        public AcceptingRecipientActor(ActorAddress address)
            : base($"recipient-{address.Value.Replace('/', '-')}")
        {
            _address = address;
            Command<DeliveryAttemptOffer>(Handle);
            Command<GetAcceptedCommandCount>(_ => Sender.Tell(ProcessedCommands.Count));
        }

        private void Handle(DeliveryAttemptOffer offer)
        {
            var replyTo = Sender;
            var decision = Decide(offer.Envelope.CommandId, offer.PayloadHash);

            switch (decision.Kind)
            {
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Accepted:
                    PersistAcceptance(
                        new Aven.ActorKernel.Messages.ProcessedCommandAccepted(offer.Envelope.CommandId, offer.PayloadHash, DateTimeOffset.UtcNow, "accepted"),
                        _ => replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted")));
                    break;

                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Duplicate:
                    replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "duplicate"));
                    break;

                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Conflict:
                    replyTo.Tell(new DeliveryRejected(
                        offer.DeliveryId,
                        offer.Envelope.CommandId,
                        _address,
                        new OperationError("payload_conflict", "Conflicting duplicate payload.", false)));
                    break;
            }
        }
    }

    private sealed class CountingAcceptingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private int _offers;

        public CountingAcceptingRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer =>
            {
                _offers++;
                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted"));
            });
            Receive<GetOfferCount>(_ => Sender.Tell(_offers));
        }
    }

    private sealed record GetTerminalSignal;

    private sealed class TerminalSignalProbeActor : ReceiveActor
    {
        private DeliveryTerminalSignal? _signal;

        public TerminalSignalProbeActor()
        {
            Receive<DeliveryTerminalSignal>(signal => _signal = signal);
            Receive<GetTerminalSignal>(_ => Sender.Tell(_signal ?? throw new InvalidOperationException("No terminal signal captured yet.")));
        }
    }
}