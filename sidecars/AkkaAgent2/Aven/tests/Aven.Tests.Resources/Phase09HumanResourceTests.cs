using Akka.Actor;
using Akka.Configuration;
using System.Collections.Concurrent;
using System.Text.Json;
using Aven.ActorKernel.Addressing;
using Aven.Akka.Hosting;
using Aven.Api.Persistence.HumanPrompts;
using Aven.Contracts.Messaging;
using Aven.Contracts.Protocol;
using Aven.Resources.Human;
using Aven.Resources.Human.Gateways;
using Aven.Resources.Runtime.Gateways;
using Aven.Resources.Runtime.Inbox;
using Aven.Resources.Human.Persistence.HumanPrompts;

namespace Aven.Tests.Resources;

public sealed class Phase09HumanResourceTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase09-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public async Task PromptSurvivesRestart()
    {
        var key = CreateOperationKey("req-restart");
        var expectedPromptId = HumanPromptIdentity.FromOperationKey(key);

        await WithSystem(async system =>
        {
            var actor = CreatePromptActor(system, "human-prompt-restart", key);
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            Assert.Equal(expectedPromptId, state.PromptId);
            Assert.Equal(HumanPromptStatus.Open, state.Status);
        });

        await WithSystem(async system =>
        {
            var actor = CreatePromptActor(system, "human-prompt-restart", key);
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            Assert.Equal(expectedPromptId, state.PromptId);
            Assert.Equal(HumanPromptStatus.Open, state.Status);
            Assert.Equal("Please approve the proposed ledger update.", state.PromptText);
        });
    }

    [Fact]
    public async Task AnswerTerminalizesPrompt_AndOperationReplyCanBeSynthesizedAfterRestart()
    {
        var key = CreateOperationKey("req-answer");
        var promptId = HumanPromptIdentity.FromOperationKey(key);

        await WithSystem(async system =>
        {
            var actor = CreatePromptActor(system, "human-prompt-answer", key);
            var accepted = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));

            var reply = Assert.IsType<HumanPromptAnswerAccepted>(accepted);
            Assert.False(reply.Idempotent);
        });

        await WithSystem(async system =>
        {
            var actor = CreatePromptActor(system, "human-prompt-answer", key);
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var operationReply = await actor.Ask<object>(new HumanPromptGetOperationReply(), TimeSpan.FromSeconds(3));

            Assert.Equal(HumanPromptStatus.Answered, state.Status);
            Assert.Equal("approve", state.Answer);

            var resolved = Assert.IsType<OperationResolved>(operationReply);
            Assert.Equal(key, resolved.Key);
            Assert.Equal("human.answer", resolved.Value.Kind);
            Assert.Contains(promptId.Value, resolved.Value.ValueJson, StringComparison.Ordinal);
            Assert.Contains("approve", resolved.Value.ValueJson, StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task ApiCannotAnswerByRequestId_MismatchedPromptIdIsRejected()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-mismatch");
            var actor = CreatePromptActor(system, "human-prompt-mismatch", key);
            var wrongPromptId = new PromptId("request-id-only-is-not-valid");

            var rejected = await actor.Ask<object>(new HumanPromptAnswer(wrongPromptId, "approve"), TimeSpan.FromSeconds(3));

            var reply = Assert.IsType<HumanPromptAnswerRejected>(rejected);
            Assert.Equal("prompt_id_mismatch", reply.Error.Code);
        });
    }

    [Fact]
    public async Task SameAnswerDuplicate_IsIdempotent_AndDifferentSecondAnswerConflicts()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-duplicate");
            var actor = CreatePromptActor(system, "human-prompt-duplicate", key);
            var promptId = HumanPromptIdentity.FromOperationKey(key);

            var first = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));
            var second = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));
            var conflict = await actor.Ask<object>(new HumanPromptAnswer(promptId, "reject"), TimeSpan.FromSeconds(3));

            Assert.IsType<HumanPromptAnswerAccepted>(first);

            var idempotent = Assert.IsType<HumanPromptAnswerAccepted>(second);
            Assert.True(idempotent.Idempotent);

            var conflictReply = Assert.IsType<HumanPromptAnswerConflict>(conflict);
            Assert.Equal("prompt_answer_conflict", conflictReply.Error.Code);
        });
    }

    [Fact]
    public async Task LateAnswerAfterExpiry_IsRejectedAndRecorded()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-expired");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var actor = CreatePromptActor(system, "human-prompt-expired", key, DateTimeOffset.UtcNow.AddMinutes(-5));

            var reply = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve", DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            var rejected = Assert.IsType<HumanPromptAnswerRejected>(reply);
            Assert.Equal("prompt_expired", rejected.Error.Code);
            Assert.Equal(HumanPromptStatus.Expired, state.Status);
            Assert.Single(state.LateAnswers);
            Assert.Equal("approve", state.LateAnswers[0].Answer);
        });
    }

    [Fact]
    public async Task HumanPromptExpiresAtDeadline_PersistsExpiredWithoutAnswer()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-expire-deadline");
            var actor = CreatePromptActor(system, "human-prompt-expire-deadline", key, DateTimeOffset.UtcNow.AddMilliseconds(200));

            var state = await AssertEventually(async () =>
                await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static state => state.Status == HumanPromptStatus.Expired,
                timeout: TimeSpan.FromSeconds(5));

            Assert.Equal(HumanPromptStatus.Expired, state.Status);
            Assert.Empty(state.LateAnswers);
        });
    }

    [Fact]
    public async Task HumanPromptExpired_OperationReplyIsOperationTimedOut()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-expired-operation-reply");
            var actor = CreatePromptActor(system, "human-prompt-expired-operation-reply", key, DateTimeOffset.UtcNow.AddMilliseconds(200));

            _ = await AssertEventually(async () =>
                await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static state => state.Status == HumanPromptStatus.Expired,
                timeout: TimeSpan.FromSeconds(5));

            var operationReply = await actor.Ask<object>(new HumanPromptGetOperationReply(), TimeSpan.FromSeconds(3));

            var timedOut = Assert.IsType<OperationTimedOut>(operationReply);
            Assert.Equal(key, timedOut.Key);
            Assert.Equal("human_prompt_expired", timedOut.Error.Code);
            Assert.False(timedOut.Error.Retryable);
        });
    }

    [Fact]
    public async Task HumanPromptExpiry_PublishesTerminalReplyToAdapter()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-expiry-owner-notify");
            var adapterAddress = new ActorAddress("adapter/human", "local");
            var resolver = new LocalActorAddressRegistry();
            var adapterProbe = system.ActorOf(Props.Create(() => new RecordingActor()), "human-prompt-expiry-adapter-probe");
            resolver.Register(adapterAddress, adapterProbe);

            var actor = system.ActorOf(
                Props.Create(() => new HumanPromptActor(
                    "human-prompt-expiry-owner-notify",
                    key,
                    new CorrelationId("corr-req-expiry-owner-notify"),
                    adapterAddress,
                    "Please approve the proposed ledger update.",
                    DateTimeOffset.UtcNow.AddMilliseconds(200),
                    null,
                    null,
                    null,
                    resolver)),
                "human-prompt-expiry-owner-notify");

            var state = await AssertEventually(async () =>
                await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static item => item.Status == HumanPromptStatus.Expired,
                timeout: TimeSpan.FromSeconds(5));
            var messages = await AssertEventually(async () =>
                await adapterProbe.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static recorded => recorded.OfType<HumanPromptTerminalReplyReady>().Any(),
                timeout: TimeSpan.FromSeconds(5));

            Assert.Equal(HumanPromptStatus.Expired, state.Status);
            var timedOut = Assert.Single(messages.OfType<HumanPromptTerminalReplyReady>());
            Assert.Equal(key, timedOut.Key);
            Assert.Equal(HumanPromptStatus.Expired, timedOut.Status);
            Assert.Equal("human_prompt_expired", timedOut.Error?.Code);
            Assert.False(timedOut.Error?.Retryable);
        });
    }

    [Fact]
    public async Task HumanPromptAnswerAfterExpiry_PublishesTerminalReplyToAdapter_AndRecordsLateAnswer()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-answer-after-expiry-owner-notify");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var adapterAddress = new ActorAddress("adapter/human", "local");
            var resolver = new LocalActorAddressRegistry();
            var adapterProbe = system.ActorOf(Props.Create(() => new RecordingActor()), "human-prompt-answer-after-expiry-adapter-probe");
            resolver.Register(adapterAddress, adapterProbe);

            var actor = system.ActorOf(
                Props.Create(() => new HumanPromptActor(
                    "human-prompt-answer-after-expiry-owner-notify",
                    key,
                    new CorrelationId("corr-req-answer-after-expiry-owner-notify"),
                    adapterAddress,
                    "Please approve the proposed ledger update.",
                    DateTimeOffset.UtcNow.AddMilliseconds(200),
                    null,
                    null,
                    null,
                    resolver)),
                "human-prompt-answer-after-expiry-owner-notify");

            _ = await AssertEventually(async () =>
                await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static state => state.Status == HumanPromptStatus.Expired,
                timeout: TimeSpan.FromSeconds(5));

            var reply = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve", DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var state = await AssertEventually(async () =>
                await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static item => item.LateAnswers.Count == 1,
                timeout: TimeSpan.FromSeconds(5));
            var messages = await AssertEventually(async () =>
                await adapterProbe.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static recorded => recorded.OfType<HumanPromptTerminalReplyReady>().Any(),
                timeout: TimeSpan.FromSeconds(5));

            var rejected = Assert.IsType<HumanPromptAnswerRejected>(reply);
            Assert.Equal("prompt_expired", rejected.Error.Code);
            Assert.Equal(HumanPromptStatus.Expired, state.Status);
            Assert.Single(state.LateAnswers);
            Assert.Equal("approve", state.LateAnswers[0].Answer);
            var published = Assert.Single(messages.OfType<HumanPromptTerminalReplyReady>());
            Assert.Equal(HumanPromptStatus.Expired, published.Status);
            Assert.Equal("human_prompt_expired", published.Error?.Code);
        });
    }

    [Fact]
    public async Task HumanPromptAnswer_TerminalReplyRemainsPendingUntilAcknowledged_AndRecoveryRepublishes()
    {
        var key = CreateOperationKey("req-terminal-ack-recovery");
        var promptId = HumanPromptIdentity.FromOperationKey(key);
        var adapterAddress = new ActorAddress("adapter/human", "local");

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var adapterProbe = system.ActorOf(Props.Create(() => new RecordingActor()), "human-prompt-ack-recovery-adapter-1");
            resolver.Register(adapterAddress, adapterProbe);

            var actor = CreatePromptActor(system, "human-prompt-ack-recovery", key, resolver: resolver, adapterAddress: adapterAddress);
            _ = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));

            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var messages = await AssertEventually(async () =>
                    await adapterProbe.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static recorded => recorded.OfType<HumanPromptTerminalReplyReady>().Count() == 1,
                timeout: TimeSpan.FromSeconds(5));

            Assert.True(state.TerminalReplyPending);
            Assert.False(state.TerminalReplyAcknowledged);
            var ready = Assert.Single(messages.OfType<HumanPromptTerminalReplyReady>());
            Assert.Equal(promptId, ready.PromptId);
            Assert.Equal(HumanPromptStatus.Answered, ready.Status);
            Assert.Equal("approve", ready.Answer);
        });

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var adapterProbe = system.ActorOf(Props.Create(() => new RecordingActor()), "human-prompt-ack-recovery-adapter-2");
            resolver.Register(adapterAddress, adapterProbe);

            var actor = CreatePromptActor(system, "human-prompt-ack-recovery", key, resolver: resolver, adapterAddress: adapterAddress);
            var republished = await AssertEventually(async () =>
                    await adapterProbe.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static recorded => recorded.OfType<HumanPromptTerminalReplyReady>().Any(),
                timeout: TimeSpan.FromSeconds(5));
            var recoveredState = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            Assert.True(recoveredState.TerminalReplyPending);
            Assert.False(recoveredState.TerminalReplyAcknowledged);
            Assert.Single(republished.OfType<HumanPromptTerminalReplyReady>());

            actor.Tell(new HumanPromptTerminalReplyAcknowledged(promptId));

            var ackedState = await AssertEventually(async () =>
                    await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static state => !state.TerminalReplyPending && state.TerminalReplyAcknowledged,
                timeout: TimeSpan.FromSeconds(5));

            Assert.False(ackedState.TerminalReplyPending);
            Assert.True(ackedState.TerminalReplyAcknowledged);
        });

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var adapterProbe = system.ActorOf(Props.Create(() => new RecordingActor()), "human-prompt-ack-recovery-adapter-3");
            resolver.Register(adapterAddress, adapterProbe);

            var actor = CreatePromptActor(system, "human-prompt-ack-recovery", key, resolver: resolver, adapterAddress: adapterAddress);
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            await Task.Delay(300);
            var messages = await adapterProbe.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));

            Assert.False(state.TerminalReplyPending);
            Assert.True(state.TerminalReplyAcknowledged);
            Assert.Empty(messages.OfType<HumanPromptTerminalReplyReady>());
        });
    }

    [Fact]
    public async Task HumanPromptAnsweredBeforeExpiry_CancelsExpiryTimer()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-answer-before-expiry");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var actor = CreatePromptActor(system, "human-prompt-answer-before-expiry", key, DateTimeOffset.UtcNow.AddMilliseconds(500));

            var answered = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));
            await Task.Delay(900);
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var operationReply = await actor.Ask<object>(new HumanPromptGetOperationReply(), TimeSpan.FromSeconds(3));

            Assert.IsType<HumanPromptAnswerAccepted>(answered);
            Assert.Equal(HumanPromptStatus.Answered, state.Status);
            Assert.Empty(state.LateAnswers);
            Assert.IsType<OperationResolved>(operationReply);
        });
    }

    [Fact]
    public async Task HumanPromptCancelledBeforeExpiry_CancelsExpiryTimer()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-cancel-before-expiry");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var actor = CreatePromptActor(system, "human-prompt-cancel-before-expiry", key, DateTimeOffset.UtcNow.AddMilliseconds(500));

            var cancelled = await actor.Ask<object>(new HumanPromptCancel(promptId, "user_cancelled"), TimeSpan.FromSeconds(3));
            await Task.Delay(900);
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var operationReply = await actor.Ask<object>(new HumanPromptGetOperationReply(), TimeSpan.FromSeconds(3));

            Assert.IsType<HumanPromptCancellationAccepted>(cancelled);
            Assert.Equal(HumanPromptStatus.Cancelled, state.Status);
            Assert.Empty(state.LateAnswers);
            Assert.IsType<OperationCancelled>(operationReply);
        });
    }

    [Fact]
    public async Task Answer_RequiresCapability_WhenAuthorityConfigured()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-capability");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var authority = CreateHumanAuthority();
            var actor = system.ActorOf(
                Props.Create(() => new HumanPromptActor(
                    "human-prompt-capability",
                    key,
                    new CorrelationId("corr-req-capability"),
                    new ActorAddress("adapter/human", "local"),
                    "Please approve the proposed ledger update.",
                    null,
                    null,
                    authority)),
                "human-prompt-capability");

            var reply = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));

            var rejected = Assert.IsType<HumanPromptAnswerRejected>(reply);
            Assert.Equal("capability_required", rejected.Error.Code);
        });
    }

    [Fact]
    public async Task HumanPromptCancel_CancelsOpenPromptAndRejectsLaterAnswer()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-cancel");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var actor = CreatePromptActor(system, "human-prompt-cancel", key);

            var cancelled = await actor.Ask<object>(new HumanPromptCancel(promptId, "user_cancelled"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var answered = await actor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));
            var operationReply = await actor.Ask<object>(new HumanPromptGetOperationReply(), TimeSpan.FromSeconds(3));

            var accepted = Assert.IsType<HumanPromptCancellationAccepted>(cancelled);
            Assert.False(accepted.Idempotent);
            Assert.Equal(HumanPromptStatus.Cancelled, state.Status);
            Assert.Equal("user_cancelled", state.CancelReason);
            Assert.NotNull(state.CancelledAt);

            var rejected = Assert.IsType<HumanPromptAnswerRejected>(answered);
            Assert.Equal("prompt_cancelled", rejected.Error.Code);

            var cancelledReply = Assert.IsType<OperationCancelled>(operationReply);
            Assert.Equal(key, cancelledReply.Key);
        });
    }

    [Fact]
    public async Task HumanPromptCancel_OperationReplyIsOperationCancelled()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-cancel-operation-reply");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var actor = CreatePromptActor(system, "human-prompt-cancel-operation-reply", key);

            var cancelled = await actor.Ask<object>(new HumanPromptCancel(promptId, "user_cancelled"), TimeSpan.FromSeconds(3));
            var operationReply = await actor.Ask<object>(new HumanPromptGetOperationReply(), TimeSpan.FromSeconds(3));

            Assert.IsType<HumanPromptCancellationAccepted>(cancelled);
            var operationCancelled = Assert.IsType<OperationCancelled>(operationReply);
            Assert.Equal(key, operationCancelled.Key);
            Assert.Equal(new ActorAddress("adapter/human", "local"), operationCancelled.Adapter);
        });
    }

    [Fact]
    public async Task HumanPromptCancel_IsRecoveredAfterRestart()
    {
        var key = CreateOperationKey("req-cancel-restart");
        var promptId = HumanPromptIdentity.FromOperationKey(key);

        await WithSystem(async system =>
        {
            var actor = CreatePromptActor(system, "human-prompt-cancel-restart", key);
            var cancelled = await actor.Ask<object>(new HumanPromptCancel(promptId, "cancel_before_restart"), TimeSpan.FromSeconds(3));
            Assert.IsType<HumanPromptCancellationAccepted>(cancelled);
        });

        await WithSystem(async system =>
        {
            var actor = CreatePromptActor(system, "human-prompt-cancel-restart", key);
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            Assert.Equal(HumanPromptStatus.Cancelled, state.Status);
            Assert.Equal("cancel_before_restart", state.CancelReason);
            Assert.NotNull(state.CancelledAt);
        });
    }

    [Fact]
    public async Task HumanPromptCancel_RejectsMissingReasonWithoutStateChange()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-cancel-missing-reason");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var actor = CreatePromptActor(system, "human-prompt-cancel-missing-reason", key);

            var reply = await actor.Ask<object>(new HumanPromptCancel(promptId, "   "), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            var rejected = Assert.IsType<HumanPromptCancellationRejected>(reply);
            Assert.Equal("missing_cancel_reason", rejected.Error.Code);
            Assert.Equal(HumanPromptStatus.Open, state.Status);
            Assert.Null(state.CancelReason);
            Assert.Null(state.CancelledAt);
        });
    }

    [Fact]
    public async Task HumanPromptCancel_RepeatedCancelReturnsStoredReasonIdempotently()
    {
        await WithSystem(async system =>
        {
            var key = CreateOperationKey("req-cancel-idempotent-reason");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var actor = CreatePromptActor(system, "human-prompt-cancel-idempotent-reason", key);

            var first = await actor.Ask<object>(new HumanPromptCancel(promptId, "first_reason"), TimeSpan.FromSeconds(3));
            var second = await actor.Ask<object>(new HumanPromptCancel(promptId, "second_reason"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            var firstAccepted = Assert.IsType<HumanPromptCancellationAccepted>(first);
            Assert.False(firstAccepted.Idempotent);
            Assert.Equal("first_reason", firstAccepted.Reason);

            var secondAccepted = Assert.IsType<HumanPromptCancellationAccepted>(second);
            Assert.True(secondAccepted.Idempotent);
            Assert.Equal("first_reason", secondAccepted.Reason);

            Assert.Equal(HumanPromptStatus.Cancelled, state.Status);
            Assert.Equal("first_reason", state.CancelReason);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_AnswerWaitsForInboxCompletionBeforeAcknowledgingPrompt_AndDuplicateReadyIsIdempotent()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-answer-ack-order", new ControlledInboxStore());
            harness.InboxStore.BlockNextMarkCompleted();

            var offer = CreateDeliveryAttemptOffer(
                "human.approve",
                new ActorAddress("role-agent/test", "local"),
                new ActorAddress("resource/human", "local"),
                harness.ReplyTo,
                JsonSerializer.Serialize(new HumanPromptOperationPayload(
                    "human-ack-order-1",
                    "Please approve the proposed ledger update.",
                    "human-approve-cap")));

            var accepted = await harness.Adapter.Ask<object>(offer, TimeSpan.FromSeconds(5));
            Assert.IsType<DeliveryAccepted>(accepted);

            var key = new OperationKey(offer.Envelope.Sender, new RequestId("human-ack-order-1"), offer.Envelope.MessageType);
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = await harness.GetPromptActorAsync(promptId.Value);

            _ = await promptActor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(5));
            await harness.InboxStore.WaitForBlockedMarkCompletedAsync(TimeSpan.FromSeconds(5));

            var pendingState = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var beforeReleaseMessages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));

            Assert.True(pendingState.TerminalReplyPending);
            Assert.False(pendingState.TerminalReplyAcknowledged);
            Assert.DoesNotContain(beforeReleaseMessages, static message => message is OperationResolved);

            harness.InboxStore.ReleaseBlockedMarkCompleted();

            var ackedState = await AssertEventually(async () =>
                    await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static state => !state.TerminalReplyPending && state.TerminalReplyAcknowledged,
                timeout: TimeSpan.FromSeconds(5));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);
            var resolved = await AssertEventually(async () =>
                    await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static messages => messages.OfType<OperationResolved>().Any(),
                timeout: TimeSpan.FromSeconds(5));

            var terminalReply = new HumanPromptTerminalReplyReady(promptId, key, offer.Envelope.CorrelationId, HumanPromptStatus.Answered, Answer: "approve", AnsweredAt: ackedState.AnsweredAt);
            harness.Adapter.Tell(terminalReply, promptActor);
            await Task.Delay(200);

            var afterDuplicateMessages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));

            Assert.Single(resolved.OfType<OperationResolved>());
            Assert.False(ackedState.TerminalReplyPending);
            Assert.True(ackedState.TerminalReplyAcknowledged);
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationInboxStatus.Completed, inboxRecord!.Status);
            Assert.Single(afterDuplicateMessages.OfType<OperationResolved>());
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_CancelledPrompt_MarksInboxFailed_AndAcknowledgesPrompt()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-cancel-terminal", new ControlledInboxStore());

            var offer = CreateDeliveryAttemptOffer(
                "human.approve",
                new ActorAddress("role-agent/test", "local"),
                new ActorAddress("resource/human", "local"),
                harness.ReplyTo,
                JsonSerializer.Serialize(new HumanPromptOperationPayload("human-cancel-terminal-1", "Please approve the proposed ledger update.")));

            _ = await harness.Adapter.Ask<object>(offer, TimeSpan.FromSeconds(5));

            var key = new OperationKey(offer.Envelope.Sender, new RequestId("human-cancel-terminal-1"), offer.Envelope.MessageType);
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = await harness.GetPromptActorAsync(promptId.Value);

            _ = await promptActor.Ask<object>(new HumanPromptCancel(promptId, "user_cancelled"), TimeSpan.FromSeconds(5));

            var messages = await AssertEventually(async () =>
                    await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static recorded => recorded.OfType<OperationCancelled>().Any(),
                timeout: TimeSpan.FromSeconds(5));
            var state = await AssertEventually(async () =>
                    await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static item => !item.TerminalReplyPending && item.TerminalReplyAcknowledged,
                timeout: TimeSpan.FromSeconds(5));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);

            Assert.Single(messages.OfType<OperationCancelled>());
            Assert.Equal(HumanPromptStatus.Cancelled, state.Status);
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationInboxStatus.Failed, inboxRecord!.Status);
            Assert.Equal("operation_cancelled", inboxRecord.LastErrorCode);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_ExpiredPrompt_MarksInboxFailed_AndAcknowledgesPrompt()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-expired-terminal", new ControlledInboxStore());

            var offer = CreateDeliveryAttemptOffer(
                "human.approve",
                new ActorAddress("role-agent/test", "local"),
                new ActorAddress("resource/human", "local"),
                harness.ReplyTo,
                JsonSerializer.Serialize(new HumanPromptOperationPayload(
                    "human-expired-terminal-1",
                    "Please approve the proposed ledger update.",
                    null,
                    DateTimeOffset.UtcNow.AddMilliseconds(200))));

            _ = await harness.Adapter.Ask<object>(offer, TimeSpan.FromSeconds(5));

            var key = new OperationKey(offer.Envelope.Sender, new RequestId("human-expired-terminal-1"), offer.Envelope.MessageType);
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = await harness.GetPromptActorAsync(promptId.Value);

            var messages = await AssertEventually(async () =>
                    await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static recorded => recorded.OfType<OperationTimedOut>().Any(),
                timeout: TimeSpan.FromSeconds(8));
            var state = await AssertEventually(async () =>
                    await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static item => item.Status == HumanPromptStatus.Expired && !item.TerminalReplyPending && item.TerminalReplyAcknowledged,
                timeout: TimeSpan.FromSeconds(8));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);

            var timedOut = Assert.Single(messages.OfType<OperationTimedOut>());
            Assert.Equal("human_prompt_expired", timedOut.Error.Code);
            Assert.Equal(HumanPromptStatus.Expired, state.Status);
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationInboxStatus.Failed, inboxRecord!.Status);
            Assert.Equal("human_prompt_expired", inboxRecord.LastErrorCode);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_IgnoresTerminalReply_WhenResourceKindDoesNotMatch()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-resource-kind-mismatch", new ControlledInboxStore());
            var key = CreateOperationKey("req-resource-kind-mismatch");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = CreatePromptActor(system, "human-prompt-resource-kind-mismatch", key, adapterAddress: HumanAdapterAddress);
            _ = await promptActor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));
            var promptState = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            await harness.InboxStore.RecordIntentAsync(CreateInboxRecord(key, harness.ReplyTo, resourceKind: "metadata"));

            harness.Adapter.Tell(new HumanPromptTerminalReplyReady(promptId, key, new CorrelationId("corr-resource-kind-mismatch"), HumanPromptStatus.Answered, Answer: "approve"), promptActor);
            await Task.Delay(300);

            var state = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);
            var messages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));

            Assert.True(state.TerminalReplyPending);
            Assert.False(state.TerminalReplyAcknowledged);
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationInboxStatus.Recorded, inboxRecord!.Status);
            Assert.Empty(messages);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_IgnoresTerminalReply_WhenPromptIdDoesNotMatchKey()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-prompt-id-mismatch", new ControlledInboxStore());
            var key = CreateOperationKey("req-prompt-id-mismatch");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = CreatePromptActor(system, "human-prompt-prompt-id-mismatch", key, adapterAddress: HumanAdapterAddress);
            _ = await promptActor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));

            await harness.InboxStore.RecordIntentAsync(CreateInboxRecord(key, harness.ReplyTo));

            harness.Adapter.Tell(new HumanPromptTerminalReplyReady(new PromptId("wrong-prompt-id"), key, new CorrelationId("corr-prompt-id-mismatch"), HumanPromptStatus.Answered, Answer: "approve"), promptActor);
            await Task.Delay(300);

            var state = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);
            var messages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));

            Assert.True(state.TerminalReplyPending);
            Assert.False(state.TerminalReplyAcknowledged);
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationInboxStatus.Recorded, inboxRecord!.Status);
            Assert.Empty(messages);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_DoesNotTerminalizeAnotherInboxRow_WhenOperationKeyDoesNotMatchPrompt()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-operation-key-mismatch", new ControlledInboxStore());
            var keyA = CreateOperationKey("req-operation-key-mismatch-a");
            var keyB = CreateOperationKey("req-operation-key-mismatch-b");
            var promptIdA = HumanPromptIdentity.FromOperationKey(keyA);
            var promptActorA = CreatePromptActor(system, "human-prompt-operation-key-mismatch-a", keyA, adapterAddress: HumanAdapterAddress);
            _ = await promptActorA.Ask<object>(new HumanPromptAnswer(promptIdA, "approve"), TimeSpan.FromSeconds(3));

            await harness.InboxStore.RecordIntentAsync(CreateInboxRecord(keyA, harness.ReplyTo));
            await harness.InboxStore.RecordIntentAsync(CreateInboxRecord(keyB, harness.ReplyTo));

            harness.Adapter.Tell(new HumanPromptTerminalReplyReady(promptIdA, keyB, new CorrelationId("corr-operation-key-mismatch"), HumanPromptStatus.Answered, Answer: "approve"), promptActorA);
            await Task.Delay(300);

            var stateA = await promptActorA.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var inboxRecordA = await harness.InboxStore.GetAsync(FormatOperationKey(keyA), CancellationToken.None);
            var inboxRecordB = await harness.InboxStore.GetAsync(FormatOperationKey(keyB), CancellationToken.None);
            var messages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));

            Assert.True(stateA.TerminalReplyPending);
            Assert.False(stateA.TerminalReplyAcknowledged);
            Assert.Equal(ResourceOperationInboxStatus.Recorded, inboxRecordA!.Status);
            Assert.Equal(ResourceOperationInboxStatus.Recorded, inboxRecordB!.Status);
            Assert.Null(inboxRecordA.TerminalReplyKind);
            Assert.Null(inboxRecordA.TerminalReplyPayloadJson);
            Assert.Null(inboxRecordA.TerminalReplyDeliveryStatus);
            Assert.Null(inboxRecordB.TerminalReplyKind);
            Assert.Null(inboxRecordB.TerminalReplyPayloadJson);
            Assert.Null(inboxRecordB.TerminalReplyDeliveryStatus);
            Assert.Empty(messages);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_ReplaysPendingTerminalReplyAfterAdapterRestart()
    {
        var inboxPath = Path.Combine(Path.GetTempPath(), $"aven-phase09-human-replay-{Guid.NewGuid():N}.sqlite");
        var inboxStore = new ResourceOperationInboxStore($"Data Source={inboxPath}");
        var key = CreateOperationKey("req-adapter-replay");
        var promptId = HumanPromptIdentity.FromOperationKey(key);
        var replyTo = new ActorAddress("tests/replies/human-adapter-replay", "local");

        await inboxStore.RecordIntentAsync(CreateInboxRecord(key, replyTo));
        await inboxStore.TryRecordTerminalReplyPendingAsync(
            FormatOperationKey(key),
            new ResourceOperationInboxStore.TerminalReplyRecord(
                ResourceOperationInboxStatus.Completed,
                "resolved",
                JsonSerializer.Serialize(new
                {
                    kind = "human.answer",
                    promptId = promptId.Value,
                    answer = "approve",
                    answeredAt = DateTimeOffset.UtcNow
                }),
                null,
                null));

        try
        {
            await WithSystem(async system =>
            {
                var resolver = new LocalActorAddressRegistry();
                var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "human-adapter-replay-replies");
                resolver.Register(replyTo, replyRecorder);

                var registry = system.ActorOf(
                    Props.Create(() => new HumanPromptRegistryActor("human-adapter-replay-registry")),
                    "human-adapter-replay-registry");

                _ = system.ActorOf(
                    Props.Create(() => new HumanGatewayActor(
                        CreateFailingPromptFactory(),
                        registry,
                        inboxStore,
                        resolver)),
                    "human-adapter-replay-adapter");

                var published = await AssertEventually(async () =>
                        await replyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                    static messages => messages.OfType<OperationResolved>().Any(),
                    timeout: TimeSpan.FromSeconds(5));

                var resolved = Assert.Single(published.OfType<OperationResolved>());
                var updated = await inboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);

                Assert.Equal(key, resolved.Key);
                Assert.Equal("human.answer", resolved.Value.Kind);
                Assert.Contains(promptId.Value, resolved.Value.ValueJson, StringComparison.Ordinal);
                Assert.Contains("approve", resolved.Value.ValueJson, StringComparison.Ordinal);
                Assert.NotNull(updated);
                Assert.Equal(ResourceOperationInboxStatus.Completed, updated!.Status);
                Assert.Equal(ResourceOperationTerminalReplyDeliveryStatus.Delivered, updated.TerminalReplyDeliveryStatus);
                Assert.NotNull(updated.TerminalReplyDeliveredAt);
            });
        }
        finally
        {
            if (File.Exists(inboxPath))
            {
                File.Delete(inboxPath);
            }
        }
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_TerminalRecordWithoutDeliveryStatus_ReplaysBusinessResult_AndThenAcknowledgesPrompt()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-terminal-idempotent", new ControlledInboxStore());
            var key = CreateOperationKey("req-terminal-idempotent");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = CreatePromptActor(system, "human-prompt-terminal-idempotent", key, adapterAddress: HumanAdapterAddress);
            _ = await promptActor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));

            await harness.InboxStore.RecordIntentAsync(CreateInboxRecord(key, harness.ReplyTo, status: ResourceOperationInboxStatus.Completed, completedAt: DateTimeOffset.UtcNow));

            harness.Adapter.Tell(new HumanPromptTerminalReplyReady(promptId, key, new CorrelationId("corr-terminal-idempotent"), HumanPromptStatus.Answered, Answer: "approve"), promptActor);

            var published = await AssertEventually(async () =>
                    await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3)),
                static recorded => recorded.OfType<OperationResolved>().Any(),
                timeout: TimeSpan.FromSeconds(5));
            var state = await AssertEventually(async () =>
                    await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static item => !item.TerminalReplyPending && item.TerminalReplyAcknowledged,
                timeout: TimeSpan.FromSeconds(5));
            var messages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);

            Assert.Single(published.OfType<OperationResolved>());
            Assert.False(state.TerminalReplyPending);
            Assert.True(state.TerminalReplyAcknowledged);
            Assert.Single(messages.OfType<OperationResolved>());
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationTerminalReplyDeliveryStatus.Delivered, inboxRecord!.TerminalReplyDeliveryStatus);
            Assert.NotNull(inboxRecord.TerminalReplyDeliveredAt);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_DeliveredAnsweredReply_WithSameAnswer_AcknowledgesWithoutRepublishing()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-delivered-same-answer", new ControlledInboxStore());
            var key = CreateOperationKey("req-delivered-same-answer");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = CreatePromptActor(system, "human-prompt-delivered-same-answer", key, adapterAddress: HumanAdapterAddress);
            _ = await promptActor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));
            var promptState = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            await harness.InboxStore.RecordIntentAsync(CreateInboxRecord(key, harness.ReplyTo, status: ResourceOperationInboxStatus.Completed, completedAt: DateTimeOffset.UtcNow));
            _ = await harness.InboxStore.TryRecordTerminalReplyPendingAsync(
                FormatOperationKey(key),
                CreateAnsweredTerminalReplyRecord(promptId, "approve", promptState.AnsweredAt));
            _ = await harness.InboxStore.MarkTerminalReplyDeliveredAsync(FormatOperationKey(key));

            harness.Adapter.Tell(new HumanPromptTerminalReplyReady(promptId, key, new CorrelationId("corr-delivered-same-answer"), HumanPromptStatus.Answered, Answer: "approve", AnsweredAt: promptState.AnsweredAt), promptActor);

            var state = await AssertEventually(async () =>
                    await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3)),
                static item => !item.TerminalReplyPending && item.TerminalReplyAcknowledged,
                timeout: TimeSpan.FromSeconds(5));
            var messages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);

            Assert.False(state.TerminalReplyPending);
            Assert.True(state.TerminalReplyAcknowledged);
            Assert.Empty(messages.OfType<OperationResolved>());
            Assert.Empty(messages.OfType<OperationCancelled>());
            Assert.Empty(messages.OfType<OperationTimedOut>());
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationTerminalReplyDeliveryStatus.Delivered, inboxRecord!.TerminalReplyDeliveryStatus);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_DeliveredAnsweredReply_WithDifferentAnswer_ConflictsWithoutAcknowledging()
    {
        await WithSystem(async system =>
        {
            var harness = CreateHumanAdapterHarness(system, "human-adapter-delivered-different-answer", new ControlledInboxStore());
            var key = CreateOperationKey("req-delivered-different-answer");
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var promptActor = CreatePromptActor(system, "human-prompt-delivered-different-answer", key, adapterAddress: HumanAdapterAddress);
            _ = await promptActor.Ask<object>(new HumanPromptAnswer(promptId, "approve"), TimeSpan.FromSeconds(3));
            var promptState = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            await harness.InboxStore.RecordIntentAsync(CreateInboxRecord(key, harness.ReplyTo, status: ResourceOperationInboxStatus.Completed, completedAt: DateTimeOffset.UtcNow));
            _ = await harness.InboxStore.TryRecordTerminalReplyPendingAsync(
                FormatOperationKey(key),
                CreateAnsweredTerminalReplyRecord(promptId, "approve", promptState.AnsweredAt));
            _ = await harness.InboxStore.MarkTerminalReplyDeliveredAsync(FormatOperationKey(key));

            harness.Adapter.Tell(new HumanPromptTerminalReplyReady(promptId, key, new CorrelationId("corr-delivered-different-answer"), HumanPromptStatus.Answered, Answer: "reject"), promptActor);

            await Task.Delay(500);

            var state = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var messages = await harness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));
            var inboxRecord = await harness.InboxStore.GetAsync(FormatOperationKey(key), CancellationToken.None);

            Assert.True(state.TerminalReplyPending);
            Assert.False(state.TerminalReplyAcknowledged);
            Assert.Empty(messages.OfType<OperationResolved>());
            Assert.Empty(messages.OfType<OperationCancelled>());
            Assert.Empty(messages.OfType<OperationTimedOut>());
            Assert.NotNull(inboxRecord);
            Assert.Equal(ResourceOperationTerminalReplyDeliveryStatus.Delivered, inboxRecord!.TerminalReplyDeliveryStatus);
            Assert.Contains("approve", inboxRecord.TerminalReplyPayloadJson, StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_DeliveredAnsweredReply_WithCancelledOrExpiredConflict_DoesNotAcknowledge()
    {
        await WithSystem(async system =>
        {
            var cancelledHarness = CreateHumanAdapterHarness(system, "human-adapter-delivered-cancelled-conflict", new ControlledInboxStore());
            var cancelledKey = CreateOperationKey("req-delivered-cancelled-conflict");
            var cancelledPromptId = HumanPromptIdentity.FromOperationKey(cancelledKey);
            var cancelledPromptActor = CreatePromptActor(system, "human-prompt-delivered-cancelled-conflict", cancelledKey, adapterAddress: HumanAdapterAddress);
            _ = await cancelledPromptActor.Ask<object>(new HumanPromptAnswer(cancelledPromptId, "approve"), TimeSpan.FromSeconds(3));
            var cancelledPromptState = await cancelledPromptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            await cancelledHarness.InboxStore.RecordIntentAsync(CreateInboxRecord(cancelledKey, cancelledHarness.ReplyTo, status: ResourceOperationInboxStatus.Completed, completedAt: DateTimeOffset.UtcNow));
            _ = await cancelledHarness.InboxStore.TryRecordTerminalReplyPendingAsync(
                FormatOperationKey(cancelledKey),
                CreateAnsweredTerminalReplyRecord(cancelledPromptId, "approve", cancelledPromptState.AnsweredAt));
            _ = await cancelledHarness.InboxStore.MarkTerminalReplyDeliveredAsync(FormatOperationKey(cancelledKey));

            cancelledHarness.Adapter.Tell(new HumanPromptTerminalReplyReady(cancelledPromptId, cancelledKey, new CorrelationId("corr-delivered-cancelled-conflict"), HumanPromptStatus.Cancelled, CancelReason: "user_cancelled"), cancelledPromptActor);

            await Task.Delay(500);

            var cancelledState = await cancelledPromptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var cancelledMessages = await cancelledHarness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));
            Assert.True(cancelledState.TerminalReplyPending);
            Assert.False(cancelledState.TerminalReplyAcknowledged);
            Assert.Empty(cancelledMessages.OfType<OperationResolved>());
            Assert.Empty(cancelledMessages.OfType<OperationCancelled>());
            Assert.Empty(cancelledMessages.OfType<OperationTimedOut>());

            var expiredHarness = CreateHumanAdapterHarness(system, "human-adapter-delivered-expired-conflict", new ControlledInboxStore());
            var expiredKey = CreateOperationKey("req-delivered-expired-conflict");
            var expiredPromptId = HumanPromptIdentity.FromOperationKey(expiredKey);
            var expiredPromptActor = CreatePromptActor(system, "human-prompt-delivered-expired-conflict", expiredKey, adapterAddress: HumanAdapterAddress);
            _ = await expiredPromptActor.Ask<object>(new HumanPromptAnswer(expiredPromptId, "approve"), TimeSpan.FromSeconds(3));
            var expiredPromptState = await expiredPromptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));

            await expiredHarness.InboxStore.RecordIntentAsync(CreateInboxRecord(expiredKey, expiredHarness.ReplyTo, status: ResourceOperationInboxStatus.Completed, completedAt: DateTimeOffset.UtcNow));
            _ = await expiredHarness.InboxStore.TryRecordTerminalReplyPendingAsync(
                FormatOperationKey(expiredKey),
                CreateAnsweredTerminalReplyRecord(expiredPromptId, "approve", expiredPromptState.AnsweredAt));
            _ = await expiredHarness.InboxStore.MarkTerminalReplyDeliveredAsync(FormatOperationKey(expiredKey));

            expiredHarness.Adapter.Tell(new HumanPromptTerminalReplyReady(
                expiredPromptId,
                expiredKey,
                new CorrelationId("corr-delivered-expired-conflict"),
                HumanPromptStatus.Expired,
                Error: new OperationError("human_prompt_expired", $"Human prompt '{expiredPromptId.Value}' expired before it was answered.", false)), expiredPromptActor);

            await Task.Delay(500);

            var expiredState = await expiredPromptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(3));
            var expiredMessages = await expiredHarness.ReplyRecorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(3));
            Assert.True(expiredState.TerminalReplyPending);
            Assert.False(expiredState.TerminalReplyAcknowledged);
            Assert.Empty(expiredMessages.OfType<OperationResolved>());
            Assert.Empty(expiredMessages.OfType<OperationCancelled>());
            Assert.Empty(expiredMessages.OfType<OperationTimedOut>());
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_Accepts_GenericHumanPromptPayload_AndRegistersPrompt()
    {
        await WithSystem(async system =>
        {
            var registry = system.ActorOf(
                Props.Create(() => new HumanPromptRegistryActor("human-prompt-registry-adapter")),
                "human-prompt-registry-adapter");

            var promptActors = new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase);

            Func<HumanPromptRegistration, IActorRef> promptFactory = registration =>
            {
                if (promptActors.TryGetValue(registration.PromptId, out var existing))
                {
                    return existing;
                }

                var actorName = $"human-prompt-adapter-{registration.PromptId.Replace('/', '-').Replace(':', '-')}";
                var actor = system.ActorOf(
                    Props.Create(() => new HumanPromptActor(
                        $"human-prompt-adapter/{registration.PromptId}",
                        new OperationKey(
                            new ActorAddress(registration.CallerValue, registration.CallerProtocol),
                            new RequestId(registration.RequestId),
                            registration.OperationType),
                        new CorrelationId(registration.CorrelationId),
                        new ActorAddress(registration.AdapterValue, registration.AdapterProtocol),
                        registration.PromptText,
                        registration.ExpiresAt,
                        registration.CapabilityId)),
                    actorName);

                promptActors[registration.PromptId] = actor;
                return actor;
            };

            var adapter = system.ActorOf(
                Props.Create(() => new HumanGatewayActor(promptFactory, registry, CreateInboxStore("human-prompt-operation-adapter"))),
                "human-prompt-operation-adapter");

            var payload = JsonSerializer.Serialize(new HumanPromptOperationPayload(
                "human-review-1",
                "Please approve the proposed ledger update.",
                "human-approve-cap"));

            var offer = CreateDeliveryAttemptOffer(
                "human.approve",
                new ActorAddress("role-agent/test", "local"),
                new ActorAddress("resource/human", "local"),
                new ActorAddress("role-agent/test/replies", "local"),
                payload);

            var result = await adapter.Ask<object>(offer, TimeSpan.FromSeconds(5));
            var accepted = Assert.IsType<DeliveryAccepted>(result);
            Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);

            var key = new OperationKey(offer.Envelope.Sender, new RequestId("human-review-1"), offer.Envelope.MessageType);
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var registration = await AssertEventually(async () =>
                await registry.Ask<HumanPromptRegistration?>(new HumanPromptRegistryGet(promptId.Value), TimeSpan.FromSeconds(5)),
                static item => item is not null,
                timeout: TimeSpan.FromSeconds(5));

            Assert.Equal("Please approve the proposed ledger update.", registration!.PromptText);
            Assert.Equal("human-approve-cap", registration.CapabilityId);

            var promptActor = promptActors[promptId.Value];
            var state = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(5));
            Assert.Equal(promptId, state.PromptId);
            Assert.Equal(HumanPromptStatus.Open, state.Status);
            Assert.Equal("Please approve the proposed ledger update.", state.PromptText);
        });
    }

    [Fact]
    public async Task HumanPromptOperationAdapter_CarriesExpiresAtIntoRegistration()
    {
        await WithSystem(async system =>
        {
            var registry = system.ActorOf(
                Props.Create(() => new HumanPromptRegistryActor("human-prompt-registry-adapter-expiry")),
                "human-prompt-registry-adapter-expiry");

            var promptActors = new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase);

            Func<HumanPromptRegistration, IActorRef> promptFactory = registration =>
            {
                if (promptActors.TryGetValue(registration.PromptId, out var existing))
                {
                    return existing;
                }

                var actorName = $"human-prompt-adapter-expiry-{registration.PromptId.Replace('/', '-').Replace(':', '-')}";
                var actor = system.ActorOf(
                    Props.Create(() => new HumanPromptActor(
                        $"human-prompt-adapter-expiry/{registration.PromptId}",
                        new OperationKey(
                            new ActorAddress(registration.CallerValue, registration.CallerProtocol),
                            new RequestId(registration.RequestId),
                            registration.OperationType),
                        new CorrelationId(registration.CorrelationId),
                        new ActorAddress(registration.AdapterValue, registration.AdapterProtocol),
                        registration.PromptText,
                        registration.ExpiresAt,
                        registration.CapabilityId)),
                    actorName);

                promptActors[registration.PromptId] = actor;
                return actor;
            };

            var adapter = system.ActorOf(
                Props.Create(() => new HumanGatewayActor(promptFactory, registry, CreateInboxStore("human-prompt-operation-adapter-expiry"))),
                "human-prompt-operation-adapter-expiry");

            var expiresAt = DateTimeOffset.UtcNow.AddMinutes(5).ToUniversalTime();
            var payload = JsonSerializer.Serialize(new HumanPromptOperationPayload(
                "human-review-expiry",
                "Please approve the proposed ledger update.",
                "human-approve-cap",
                expiresAt));

            var offer = CreateDeliveryAttemptOffer(
                "human.approve",
                new ActorAddress("role-agent/test", "local"),
                new ActorAddress("resource/human", "local"),
                new ActorAddress("role-agent/test/replies", "local"),
                payload);

            var result = await adapter.Ask<object>(offer, TimeSpan.FromSeconds(5));
            Assert.IsType<DeliveryAccepted>(result);

            var key = new OperationKey(offer.Envelope.Sender, new RequestId("human-review-expiry"), offer.Envelope.MessageType);
            var promptId = HumanPromptIdentity.FromOperationKey(key);
            var registration = await AssertEventually(async () =>
                await registry.Ask<HumanPromptRegistration?>(new HumanPromptRegistryGet(promptId.Value), TimeSpan.FromSeconds(5)),
                static item => item is not null,
                timeout: TimeSpan.FromSeconds(5));

            Assert.Equal(expiresAt, registration!.ExpiresAt);

            var promptActor = promptActors[promptId.Value];
            var state = await promptActor.Ask<HumanPromptState>(new HumanPromptInspect(), TimeSpan.FromSeconds(5));
            Assert.Equal(expiresAt, state.ExpiresAt);
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

        var system = ActorSystem.Create($"aven-phase09-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static readonly ActorAddress HumanAdapterAddress = new("resource/human", "local");

    private static IActorRef CreatePromptActor(
        ActorSystem system,
        string persistenceId,
        OperationKey key,
        DateTimeOffset? expiresAt = null,
        IActorAddressResolver? resolver = null,
        ActorAddress? adapterAddress = null)
    {
        return system.ActorOf(
            Props.Create(() => new HumanPromptActor(
                persistenceId,
                key,
                new CorrelationId($"corr-{key.RequestId.Value}"),
                adapterAddress ?? new ActorAddress("adapter/human", "local"),
                "Please approve the proposed ledger update.",
                expiresAt,
                null,
                null,
                null,
                resolver)),
            persistenceId.Replace('/', '-'));
    }

    private static HumanAdapterHarness CreateHumanAdapterHarness(ActorSystem system, string name, ControlledInboxStore? inboxStore = null)
    {
        var resolver = new LocalActorAddressRegistry();
        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), $"{name}-reply-recorder");
        var replyTo = new ActorAddress($"tests/replies/{name}", "local");
        resolver.Register(replyTo, replyRecorder);

        var registry = system.ActorOf(
            Props.Create(() => new HumanPromptRegistryActor($"{name}-registry")),
            $"{name}-registry");

        var promptActors = new ConcurrentDictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase);
        var store = inboxStore ?? new ControlledInboxStore();
        IActorRef? adapterRef = null;

        Func<HumanPromptRegistration, IActorRef> promptFactory = registration =>
        {
            return promptActors.GetOrAdd(registration.PromptId, _ =>
            {
                var actorName = $"{name}-{registration.PromptId.Replace('/', '-').Replace(':', '-')}";
                return system.ActorOf(
                    Props.Create(() => new HumanPromptActor(
                        $"{name}/{registration.PromptId}",
                        new OperationKey(
                            new ActorAddress(registration.CallerValue, registration.CallerProtocol),
                            new RequestId(registration.RequestId),
                            registration.OperationType),
                        new CorrelationId(registration.CorrelationId),
                        new ActorAddress(registration.AdapterValue, registration.AdapterProtocol),
                        registration.PromptText,
                        registration.ExpiresAt,
                        registration.CapabilityId,
                        null,
                        null,
                        resolver)),
                    actorName);
            });
        };

        var adapter = system.ActorOf(
            Props.Create(() => new HumanGatewayActor(promptFactory, registry, store, resolver)),
            $"{name}-adapter");
        adapterRef = adapter;
        resolver.Register(HumanAdapterAddress, adapterRef);

        return new HumanAdapterHarness(adapter, registry, promptActors, resolver, replyRecorder, replyTo, store);
    }

    private static async Task<T> AssertEventually<T>(Func<Task<T>> getValue, Func<T, bool> predicate, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            var value = await getValue();
            if (predicate(value))
            {
                return value;
            }

            await Task.Delay(50);
        }

        var finalValue = await getValue();
        Assert.True(predicate(finalValue), $"Condition was not met within {timeout}. Final value: {JsonSerializer.Serialize(finalValue)}");
        return finalValue;
    }

    private static DeliveryAttemptOffer CreateDeliveryAttemptOffer(
        string messageType,
        ActorAddress sender,
        ActorAddress recipient,
        ActorAddress replyTo,
        string payload) =>
        new(
            new DeliveryId($"delivery-{Guid.NewGuid():N}"),
            new AvenEnvelope<string>(
                new CommandId($"command-{Guid.NewGuid():N}"),
                new MessageId($"message-{Guid.NewGuid():N}"),
                sender,
                recipient,
                replyTo,
                new CorrelationId($"corr-{Guid.NewGuid():N}"),
                messageType,
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            $"payload-{Guid.NewGuid():N}");

    private static OperationKey CreateOperationKey(string requestId) =>
        new(new ActorAddress("caller/a", "local"), new RequestId(requestId), "human.approve");

    private static ICapabilityAdmissionClient CreateHumanAuthority()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(new CapabilityGrant(
            new CapabilityId("human-approve-cap"),
            new ActorAddress("caller/a", "local"),
            new ActorAddress("resource/human", "local"),
            new HashSet<string>(StringComparer.Ordinal) { "human.approve" },
            new CapabilityConstraints(MaxUses: 10),
            false,
            null,
            DateTimeOffset.UtcNow.AddMinutes(5),
            null));
        return authority;
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private static Func<HumanPromptRegistration, IActorRef> CreateFailingPromptFactory()
        => static _ => throw new InvalidOperationException("Pending terminal reply recovery should not create prompt actors.");

    private static ResourceOperationInboxStore CreateInboxStore(string name) =>
        new($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-phase09-inbox-{name}-{Guid.NewGuid():N}.sqlite")}");

    private static string FormatOperationKey(OperationKey key)
        => $"{key.Caller.Protocol}|{key.Caller.Value}|{key.RequestId.Value}|{key.OperationType}";

    private static ResourceOperationInboxStore.TerminalReplyRecord CreateAnsweredTerminalReplyRecord(PromptId promptId, string answer, DateTimeOffset? answeredAt)
        => new(
            ResourceOperationInboxStatus.Completed,
            "resolved",
            JsonSerializer.Serialize(new
            {
                kind = ResourceOperationTypes.HumanAnswer,
                promptId = promptId.Value,
                answer,
                answeredAt
            }),
            null,
            null);

    private static ResourceOperationInboxRecord CreateInboxRecord(
        OperationKey key,
        ActorAddress replyTo,
        string resourceKind = "human",
        ResourceOperationInboxStatus status = ResourceOperationInboxStatus.Recorded,
        DateTimeOffset? completedAt = null)
    {
        var payloadJson = JsonSerializer.Serialize(new HumanPromptOperationPayload(
            key.RequestId.Value,
            "Please approve the proposed ledger update."));

        return new ResourceOperationInboxRecord(
            FormatOperationKey(key),
            key.Caller.Value,
            key.Caller.Protocol,
            key.RequestId.Value,
            key.OperationType,
            resourceKind,
            HumanAdapterAddress.Value,
            HumanAdapterAddress.Protocol,
            replyTo.Value,
            replyTo.Protocol,
            $"corr-{key.RequestId.Value}",
            payloadJson,
            $"hash-{key.RequestId.Value}",
            status,
            DateTimeOffset.UtcNow,
            null,
            completedAt,
            status == ResourceOperationInboxStatus.Failed ? "error" : null,
            status == ResourceOperationInboxStatus.Failed ? "error" : null,
            0,
            null);
    }

    private sealed record GetRecordedMessages;

    private sealed record HumanAdapterHarness(
        IActorRef Adapter,
        IActorRef Registry,
        ConcurrentDictionary<string, IActorRef> PromptActors,
        LocalActorAddressRegistry Resolver,
        IActorRef ReplyRecorder,
        ActorAddress ReplyTo,
        ControlledInboxStore InboxStore)
    {
        public async Task<IActorRef> GetPromptActorAsync(string promptId)
        {
            await Phase09HumanResourceTests.AssertEventually(
                () => Task.FromResult(PromptActors.ContainsKey(promptId)),
                static exists => exists,
                TimeSpan.FromSeconds(5));

            return PromptActors[promptId];
        }
    }

    private sealed class ControlledInboxStore : IResourceOperationInboxStore
    {
        private readonly ConcurrentDictionary<string, ResourceOperationInboxRecord> _records = new(StringComparer.Ordinal);
        private readonly TaskCompletionSource<bool> _terminalReplyPendingBlocked = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _terminalReplyPendingRelease = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private volatile bool _blockNextTerminalReplyPending;

        public int MaxPayloadBytes => 1024 * 1024;

        public void BlockNextMarkCompleted() => _blockNextTerminalReplyPending = true;
        public void ReleaseBlockedMarkCompleted() => _terminalReplyPendingRelease.TrySetResult(true);
        public Task WaitForBlockedMarkCompletedAsync(TimeSpan timeout) => _terminalReplyPendingBlocked.Task.WaitAsync(timeout);

        public Task<ResourceOperationInboxStore.RecordIntentResult> RecordIntentAsync(ResourceOperationInboxRecord candidate, CancellationToken cancellationToken = default)
        {
            var result = _records.TryGetValue(candidate.OperationKey, out var existing)
                ? new ResourceOperationInboxStore.RecordIntentResult(
                    existing,
                    existing.Status is ResourceOperationInboxStatus.Completed or ResourceOperationInboxStatus.Failed
                        ? ResourceOperationInboxStore.RecordIntentDisposition.AlreadyRecordedTerminal
                        : ResourceOperationInboxStore.RecordIntentDisposition.AlreadyRecordedNonTerminal)
                : new ResourceOperationInboxStore.RecordIntentResult(candidate, ResourceOperationInboxStore.RecordIntentDisposition.Inserted);

            _records[candidate.OperationKey] = result.Record;
            return Task.FromResult(result);
        }

        public Task<ResourceOperationInboxRecord?> GetAsync(string operationKey, CancellationToken cancellationToken = default)
            => Task.FromResult(_records.TryGetValue(operationKey, out var record) ? record : null);

        public Task<IReadOnlyList<ResourceOperationInboxRecord>> ListRecoverableAsync(string resourceKind, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<ResourceOperationInboxRecord>>(
                _records.Values.Where(x => x.ResourceKind == resourceKind && x.Status is ResourceOperationInboxStatus.Recorded or ResourceOperationInboxStatus.Processing).ToArray());

        public Task<IReadOnlyList<ResourceOperationInboxRecord>> ListPendingTerminalRepliesAsync(string resourceKind, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<ResourceOperationInboxRecord>>(
                _records.Values.Where(x => x.ResourceKind == resourceKind && x.TerminalReplyDeliveryStatus == ResourceOperationTerminalReplyDeliveryStatus.Pending).ToArray());

        public Task<ResourceOperationInboxRecord?> MarkProcessingAsync(string operationKey, CancellationToken cancellationToken = default)
        {
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
            if (!_records.TryGetValue(operationKey, out var record))
            {
                return null;
            }

            var updated = record with
            {
                Status = ResourceOperationInboxStatus.Completed,
                CompletedAt = DateTimeOffset.UtcNow,
                LastErrorCode = null,
                LastErrorMessage = null
            };
            _records[operationKey] = updated;
            return updated;
        }

        public Task<ResourceOperationInboxRecord?> MarkFailedAsync(string operationKey, string errorCode, string errorMessage, CancellationToken cancellationToken = default)
        {
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
                if (!HasSameTerminalReply(record, terminalReply))
                {
                    throw new ResourceOperationInboxStore.ResourceOperationInboxConflictException(operationKey);
                }

                return Task.FromResult<ResourceOperationInboxRecord?>(record);
            }

             if (record.TerminalReplyDeliveryStatus == ResourceOperationTerminalReplyDeliveryStatus.Pending)
            {
                if (!HasSameTerminalReply(record, terminalReply))
                {
                    throw new ResourceOperationInboxStore.ResourceOperationInboxConflictException(operationKey);
                }

                return Task.FromResult<ResourceOperationInboxRecord?>(record);
            }

            if (_blockNextTerminalReplyPending)
            {
                _blockNextTerminalReplyPending = false;
                _terminalReplyPendingBlocked.TrySetResult(true);
                return WaitAndRecordAsync(record, operationKey, terminalReply, cancellationToken);
            }

            return Task.FromResult<ResourceOperationInboxRecord?>(RecordPending(record, operationKey, terminalReply));
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

        private async Task<ResourceOperationInboxRecord?> WaitAndRecordAsync(
            ResourceOperationInboxRecord record,
            string operationKey,
            ResourceOperationInboxStore.TerminalReplyRecord terminalReply,
            CancellationToken cancellationToken)
        {
            await _terminalReplyPendingRelease.Task.WaitAsync(cancellationToken);
            return RecordPending(record, operationKey, terminalReply);
        }

        private ResourceOperationInboxRecord RecordPending(
            ResourceOperationInboxRecord record,
            string operationKey,
            ResourceOperationInboxStore.TerminalReplyRecord terminalReply)
        {
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
            return updated;
        }

        private static bool HasSameTerminalReply(ResourceOperationInboxRecord existing, ResourceOperationInboxStore.TerminalReplyRecord terminalReply)
            => existing.Status == terminalReply.TerminalStatus
               && string.Equals(existing.TerminalReplyKind, terminalReply.ReplyKind, StringComparison.Ordinal)
               && string.Equals(existing.TerminalReplyPayloadJson, terminalReply.ReplyPayloadJson, StringComparison.Ordinal)
               && string.Equals(existing.LastErrorCode, terminalReply.ErrorCode, StringComparison.Ordinal)
               && string.Equals(existing.LastErrorMessage, terminalReply.ErrorMessage, StringComparison.Ordinal);
    }

    private sealed class RecordingActor : ReceiveActor
    {
        private readonly List<object> _messages = new();

        public RecordingActor()
        {
            Receive<GetRecordedMessages>(_ => Sender.Tell(_messages.ToArray()));
            ReceiveAny(message => _messages.Add(message));
        }
    }
}