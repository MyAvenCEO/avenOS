using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.Scheduling.Actors.Messages;

namespace Aven.Tests.Scheduling;

public sealed class Phase15SchedulingTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase15-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public async Task ScheduleDueAfterRestart_FiresOnce()
    {
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-1);

        await WithSystem(async system =>
        {
            var actor = CreateScheduledWorkActor(system, "schedule-restart", dueAt, null, MissedRunPolicy.RunImmediately);
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(0, state.FireCount);
        });

        await WithSystem(async system =>
        {
            var actor = CreateScheduledWorkActor(system, "schedule-restart", dueAt, null, MissedRunPolicy.RunImmediately);

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var second = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow.AddSeconds(1)), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            Assert.IsType<ScheduleFired>(first);
            Assert.IsType<ScheduleNoOp>(second);
            Assert.Equal(1, state.FireCount);
            Assert.Single(state.FiredWork);
        });
    }

    [Fact]
    public async Task MissedRunAskUser_CreatesPrompt()
    {
        await WithSystem(async system =>
        {
            var actor = CreateScheduledWorkActor(system, "schedule-ask-user", DateTimeOffset.UtcNow.AddHours(-2), null, MissedRunPolicy.AskUser);

            var reply = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            var prompt = Assert.IsType<SchedulePromptRequested>(reply);
            Assert.Contains("missed its due time", prompt.PromptText, StringComparison.OrdinalIgnoreCase);
            Assert.NotNull(state.PendingPrompt);
            Assert.Empty(state.FiredWork);
        });
    }

    [Fact]
    public async Task MissedRunPolicySkip_MarksOccurrenceSkipped_AndDoesNotDeliver()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var scheduleId = "schedule-skip-once";
            var operationType = "research.run_digest";
            var targetAddress = new ActorAddress("agent/scheduled-skip-once", "local");
            var recipient = system.ActorOf(Props.Create(() => new CapturingRecipientActor(targetAddress)), "scheduled-skip-once-recipient");
            resolver.Register(targetAddress, recipient);

            var actor = CreateScheduledWorkActor(system, scheduleId, dueAt, null, MissedRunPolicy.Skip, resolver, targetAddress, operationType, "{\"paperId\":\"P-SKIP\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var firstState = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            var skipped = Assert.IsType<ScheduleSkipped>(first);
            Assert.Equal("missed_run_skipped", skipped.Reason);
            var occurrence = Assert.Single(firstState.Occurrences.Values);
            Assert.Equal(ScheduleOccurrenceStatus.Skipped, occurrence.Status);
            Assert.Equal(0, firstState.FireCount);
            Assert.Empty(firstState.FiredWork);
            Assert.Equal(dueAt, firstState.LastCompletedDueAt);
            Assert.Equal(0, await recipient.Ask<int>(new GetAcceptedCommandCount(), TimeSpan.FromSeconds(3)));

            var second = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow.AddSeconds(1)), TimeSpan.FromSeconds(3));
            var secondState = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            var noOp = Assert.IsType<ScheduleNoOp>(second);
            Assert.Equal("already_processed", noOp.Reason);
            Assert.Single(secondState.Occurrences);
            Assert.Equal(ScheduleOccurrenceStatus.Skipped, secondState.Occurrences.Values.Single().Status);
            Assert.Equal(0, await recipient.Ask<int>(new GetAcceptedCommandCount(), TimeSpan.FromSeconds(3)));
        });
    }

    [Fact]
    public async Task RecurringMissedRunPolicySkip_AdvancesToNextDueWithoutDelivery()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var recurrence = TimeSpan.FromDays(7);
            var scheduleId = "schedule-skip-recurring";
            var targetAddress = new ActorAddress("agent/scheduled-skip-recurring", "local");
            var recipient = system.ActorOf(Props.Create(() => new CapturingRecipientActor(targetAddress)), "scheduled-skip-recurring-recipient");
            resolver.Register(targetAddress, recipient);

            var actor = CreateScheduledWorkActor(system, scheduleId, dueAt, recurrence, MissedRunPolicy.Skip, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-SKIP-RECUR\"}");

            var reply = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            var skipped = Assert.IsType<ScheduleSkipped>(reply);
            Assert.Equal(dueAt.Add(recurrence), skipped.NextDueAt);
            Assert.Equal(dueAt.Add(recurrence), state.DueAt);
            Assert.Equal(ScheduleOccurrenceStatus.Skipped, Assert.Single(state.Occurrences.Values).Status);
            Assert.Equal(0, state.FireCount);
            Assert.Empty(state.FiredWork);
            Assert.Equal(0, await recipient.Ask<int>(new GetAcceptedCommandCount(), TimeSpan.FromSeconds(3)));
        });
    }

    [Fact]
    public async Task MissedRunPolicySkip_PersistsAcrossRestart()
    {
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
        var recurrence = TimeSpan.FromDays(1);

        await WithSystem(async system =>
        {
            var actor = CreateScheduledWorkActor(system, "schedule-skip-restart", dueAt, recurrence, MissedRunPolicy.Skip);
            var reply = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            Assert.IsType<ScheduleSkipped>(reply);
        });

        await WithSystem(async system =>
        {
            var actor = CreateScheduledWorkActor(system, "schedule-skip-restart", dueAt, recurrence, MissedRunPolicy.Skip);
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            Assert.Equal(dueAt.Add(recurrence), state.DueAt);
            var occurrence = Assert.Single(state.Occurrences.Values);
            Assert.Equal(ScheduleOccurrenceStatus.Skipped, occurrence.Status);
            Assert.Equal(0, state.FireCount);
            Assert.Empty(state.FiredWork);
        });
    }

    [Fact]
    public async Task RecurringWeeklyDigest_CreatesNextSchedule()
    {
        await WithSystem(async system =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var actor = CreateScheduledWorkActor(system, "schedule-weekly", dueAt, TimeSpan.FromDays(7), MissedRunPolicy.RunImmediately);

            var fired = Assert.IsType<ScheduleFired>(await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3)));
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            Assert.Equal(dueAt.AddDays(7), fired.NextDueAt);
            Assert.Equal(dueAt.AddDays(7), state.DueAt);
            Assert.Single(state.FiredWork);
        });
    }

    [Fact]
    public async Task CancelledSchedule_DoesNotFire()
    {
        await WithSystem(async system =>
        {
            var actor = CreateScheduledWorkActor(system, "schedule-cancelled", DateTimeOffset.UtcNow.AddMinutes(-5), null, MissedRunPolicy.RunImmediately);

            var cancelled = Assert.IsType<ScheduleCancellationAccepted>(await actor.Ask<object>(new CancelSchedule("user_cancelled"), TimeSpan.FromSeconds(3)));
            var reply = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            Assert.False(cancelled.Idempotent);
            var noOp = Assert.IsType<ScheduleNoOp>(reply);
            Assert.Equal("schedule_cancelled", noOp.Reason);
            Assert.Equal(ScheduleStatus.Cancelled, state.Status);
            Assert.Empty(state.FiredWork);
        });
    }

    [Fact]
    public async Task ScheduleOwnedDelivery_UsesDeterministicOccurrenceIdentity_AndDoesNotRedeliverSameOccurrence()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var targetAddress = new ActorAddress("agent/scheduled-proof", "local");
            var recipient = system.ActorOf(Props.Create(() => new CapturingRecipientActor(targetAddress)), "scheduled-proof-recipient");
            resolver.Register(targetAddress, recipient);

            var scheduleId = "schedule-deterministic-proof";
            var operationType = "research.run_digest";
            var actor = CreateScheduledWorkActor(system, scheduleId, dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, operationType, "{\"paperId\":\"P-1\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            CapturedDelivery? delivery = null;
            await AssertEventually(async () =>
            {
                delivery = await recipient.Ask<CapturedDelivery>(new GetCapturedDelivery(), TimeSpan.FromSeconds(1));
                Assert.NotNull(delivery);
            });
            await AssertEventually(async () =>
            {
                var acceptedState = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, acceptedState.FireCount);
            });

            var second = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow.AddSeconds(1)), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));

            var requested = Assert.IsType<ScheduleDeliveryRequested>(first);
            Assert.Equal(CreateExpectedOccurrenceId(scheduleId, dueAt, operationType), requested.OccurrenceId);
            var noOp = Assert.IsType<ScheduleNoOp>(second);
            Assert.Equal("already_processed", noOp.Reason);
            Assert.Equal(1, state.FireCount);
            Assert.Single(state.FiredWork);
            Assert.NotNull(delivery);
            Assert.Equal(ScheduledWorkTriggered.MessageType, delivery!.EnvelopeMessageType);
            Assert.Equal($"cmd-schedule-{CreateExpectedOccurrenceId(scheduleId, dueAt, operationType)}", delivery!.CommandId);
            Assert.Equal($"msg-schedule-{CreateExpectedOccurrenceId(scheduleId, dueAt, operationType)}", delivery.MessageId);
            Assert.Equal($"delivery-schedule-{CreateExpectedOccurrenceId(scheduleId, dueAt, operationType)}", delivery.DeliveryId);
            Assert.Equal(operationType, delivery.OperationType);
            Assert.Equal("{\"paperId\":\"P-1\"}", delivery.ValueJson);
            Assert.Equal(1, await recipient.Ask<int>(new GetAcceptedCommandCount(), TimeSpan.FromSeconds(3)));
        });
    }

    [Fact]
    public async Task ScheduledDelivery_Uses_Dedicated_ScheduledInput_WireContract_AsTrigger()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var targetAddress = new ActorAddress("agent/scheduled-wire-contract", "local");
            var recipient = system.ActorOf(Props.Create(() => new CapturingRecipientActor(targetAddress)), "scheduled-wire-contract-recipient");
            resolver.Register(targetAddress, recipient);

            var actor = CreateScheduledWorkActor(system, "schedule-wire-contract", dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-WIRE\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            Assert.IsType<ScheduleDeliveryRequested>(first);

            CapturedDelivery? delivery = null;
            await AssertEventually(async () =>
            {
                delivery = await recipient.Ask<CapturedDelivery>(new GetCapturedDelivery(), TimeSpan.FromSeconds(1));
                Assert.NotNull(delivery);
            });

            Assert.NotNull(delivery);
            Assert.Equal(ScheduledWorkTriggered.MessageType, delivery!.EnvelopeMessageType);
            Assert.Equal("research.run_digest", delivery.OperationType);
            Assert.Equal("{\"paperId\":\"P-WIRE\"}", delivery.ValueJson);
        });
    }

    [Fact]
    public async Task RejectedTargetDelivery_DoesNotIncrementFireCount_AndRetainsOccurrenceForRetry()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var targetAddress = new ActorAddress("agent/scheduled-reject", "local");
            var recipient = system.ActorOf(Props.Create(() => new RejectingRecipientActor(targetAddress)), "scheduled-reject-recipient");
            resolver.Register(targetAddress, recipient);

            var actor = CreateScheduledWorkActor(system, "schedule-rejected-proof", dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-2\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            Assert.IsType<ScheduleDeliveryRequested>(first);

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(0, state.FireCount);
                Assert.Single(state.Occurrences);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryRejected, state.Occurrences.Values.Single().Status);
            });
        });
    }

    [Fact]
    public async Task RejectedTargetDelivery_CanRetrySameOccurrenceWithFreshDeliveryAfterRecipientBecomesAccepting()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var targetAddress = new ActorAddress("agent/scheduled-retry-fresh-delivery", "local");
            var rejectingRecipient = system.ActorOf(Props.Create(() => new RejectingRecipientActor(targetAddress)), "scheduled-retry-rejecting-recipient");
            resolver.Register(targetAddress, rejectingRecipient);

            var actor = CreateScheduledWorkActor(system, "schedule-retry-fresh-delivery-proof", dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-RETRY\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var requested = Assert.IsType<ScheduleDeliveryRequested>(first);

            string? firstRejectedDeliveryId = null;
            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                var occurrence = Assert.Single(state.Occurrences.Values);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryRejected, occurrence.Status);
                Assert.Equal(0, state.FireCount);
                Assert.Empty(state.FiredWork);
                Assert.Equal(1, occurrence.DeliveryAttemptCount);
                firstRejectedDeliveryId = Assert.IsType<string>(occurrence.Delivery?.DeliveryId.Value);
            });

            var acceptingRecipient = system.ActorOf(Props.Create(() => new DelayedCapturingRecipientActor(targetAddress, TimeSpan.FromMilliseconds(300))), "scheduled-retry-accepting-recipient");
            resolver.Register(targetAddress, acceptingRecipient);

            var retry = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow.AddSeconds(1)), TimeSpan.FromSeconds(3));
            var retried = Assert.IsType<ScheduleDeliveryRequested>(retry);
            Assert.Equal(requested.OccurrenceId, retried.OccurrenceId);

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                var occurrence = Assert.Single(state.Occurrences.Values);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryRequested, occurrence.Status);
                Assert.Equal(requested.OccurrenceId, occurrence.OccurrenceId);
                Assert.Equal(2, occurrence.DeliveryAttemptCount);
                Assert.NotEqual(firstRejectedDeliveryId, occurrence.DeliveryId.Value);
                Assert.Equal($"delivery-schedule-{requested.OccurrenceId}-retry-2", occurrence.DeliveryId.Value);
                Assert.Null(occurrence.Delivery);
                Assert.Null(occurrence.Error);
                Assert.Equal(0, state.FireCount);
                Assert.Empty(state.FiredWork);
            });

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                var occurrence = Assert.Single(state.Occurrences.Values);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryAccepted, occurrence.Status);
                Assert.Equal(1, state.FireCount);
                Assert.Single(state.FiredWork);
                Assert.Single(state.Occurrences);
            });

            var captured = await acceptingRecipient.Ask<CapturedDelivery>(new GetCapturedDelivery(), TimeSpan.FromSeconds(3));
            Assert.NotEqual(firstRejectedDeliveryId, captured.DeliveryId);
            Assert.Equal(1, await acceptingRecipient.Ask<int>(new GetAcceptedCommandCount(), TimeSpan.FromSeconds(3)));
        });
    }

    [Fact]
    public async Task StaleDeliveryCompletionAfterRetry_DoesNotOverwriteCurrentOccurrence()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var targetAddress = new ActorAddress("agent/scheduled-stale-terminal", "local");
            var rejectingRecipient = system.ActorOf(Props.Create(() => new RejectingRecipientActor(targetAddress)), "scheduled-stale-terminal-rejecting-recipient");
            resolver.Register(targetAddress, rejectingRecipient);

            var actor = CreateScheduledWorkActor(system, "schedule-stale-terminal-proof", dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-STALE\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var requested = Assert.IsType<ScheduleDeliveryRequested>(first);

            string? oldDeliveryId = null;
            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                var occurrence = Assert.Single(state.Occurrences.Values);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryRejected, occurrence.Status);
                oldDeliveryId = occurrence.DeliveryId.Value;
            });

            var acceptingRecipient = system.ActorOf(Props.Create(() => new DelayedCapturingRecipientActor(targetAddress, TimeSpan.FromMilliseconds(300))), "scheduled-stale-terminal-accepting-recipient");
            resolver.Register(targetAddress, acceptingRecipient);

            var retry = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow.AddSeconds(1)), TimeSpan.FromSeconds(3));
            var retried = Assert.IsType<ScheduleDeliveryRequested>(retry);
            Assert.Equal(requested.OccurrenceId, retried.OccurrenceId);

            DeliveryId? newDeliveryId = null;
            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                var occurrence = Assert.Single(state.Occurrences.Values);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryRequested, occurrence.Status);
                Assert.NotEqual(oldDeliveryId, occurrence.DeliveryId.Value);
                newDeliveryId = occurrence.DeliveryId;
            });

            var staleReplyTarget = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "scheduled-stale-terminal-reply-recorder");
            actor.Tell(new ScheduleDeliveryCompleted(
                requested.OccurrenceId,
                new DeliveryState(
                    new DeliveryId(oldDeliveryId!),
                    new ActorAddress("schedule/schedule-stale-terminal-proof", "local"),
                    "{}",
                    targetAddress,
                    new CommandId($"cmd-schedule-{requested.OccurrenceId}"),
                    "payload-hash",
                    DeliveryStatus.Accepted,
                    1,
                    DateTimeOffset.UtcNow,
                    DateTimeOffset.UtcNow,
                    null),
                staleReplyTarget));

            var staleReply = await WaitForMessageAsync<ScheduleNoOp>(staleReplyTarget, TimeSpan.FromSeconds(3));
            var staleNoOp = Assert.IsType<ScheduleNoOp>(staleReply);
            Assert.Equal("stale_delivery_terminal", staleNoOp.Reason);

            var afterStale = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            var pendingAfterStale = Assert.Single(afterStale.Occurrences.Values);
            Assert.Equal(ScheduleOccurrenceStatus.DeliveryRequested, pendingAfterStale.Status);
            Assert.Equal(newDeliveryId, pendingAfterStale.DeliveryId);
            Assert.Equal(0, afterStale.FireCount);
            Assert.Empty(afterStale.FiredWork);

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                var occurrence = Assert.Single(state.Occurrences.Values);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryAccepted, occurrence.Status);
                Assert.Equal(1, state.FireCount);
                Assert.Single(state.FiredWork);
            });
        });
    }

    [Fact]
    public async Task ScheduleDeliveryFailed_MarksOccurrenceRejected_AndCanRetryOnNextCheck()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var targetAddress = new ActorAddress("agent/scheduled-failed", "local");
            var recipient = system.ActorOf(Props.Create(() => new SlowAcceptingRecipientActor(targetAddress, TimeSpan.FromSeconds(10))), "scheduled-failed-recipient");
            resolver.Register(targetAddress, recipient);

            var actor = CreateScheduledWorkActor(system, "schedule-delivery-failed-proof", dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-FAILED\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var requested = Assert.IsType<ScheduleDeliveryRequested>(first);

            actor.Tell(new ScheduleDeliveryFailed(
                requested.OccurrenceId,
                new OperationError("scheduled_delivery_failed", "Scheduled delivery failed before recipient acceptance.", true),
                ActorRefs.Nobody));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                var occurrence = Assert.Single(state.Occurrences.Values);
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryRejected, occurrence.Status);
                Assert.Equal("scheduled_delivery_failed", occurrence.Error?.Code);
                Assert.Equal(0, state.FireCount);
            });

            var retry = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow.AddSeconds(1)), TimeSpan.FromSeconds(3));
            var retried = Assert.IsType<ScheduleDeliveryRequested>(retry);
            Assert.Equal(requested.OccurrenceId, retried.OccurrenceId);
        });
    }

    [Fact]
    public async Task CancelSchedule_WithPendingDelivery_MarksOccurrenceCancelled_AndIgnoresLateTerminal()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var dueAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            var scheduleId = "schedule-cancel-pending";
            var targetAddress = new ActorAddress("agent/scheduled-cancel-pending", "local");
            var recipient = system.ActorOf(Props.Create(() => new SlowAcceptingRecipientActor(targetAddress, TimeSpan.FromSeconds(10))), "scheduled-cancel-pending-recipient");
            resolver.Register(targetAddress, recipient);

            var actor = CreateScheduledWorkActor(system, scheduleId, dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-CANCEL\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            var requested = Assert.IsType<ScheduleDeliveryRequested>(first);

            var pendingState = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            var pendingOccurrence = Assert.Single(pendingState.Occurrences.Values);
            Assert.Equal(ScheduleOccurrenceStatus.DeliveryRequested, pendingOccurrence.Status);

            var cancelled = await actor.Ask<object>(new CancelSchedule("user_cancelled"), TimeSpan.FromSeconds(3));
            var cancelledReply = Assert.IsType<ScheduleCancellationAccepted>(cancelled);
            Assert.False(cancelledReply.Idempotent);

            var cancelledState = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            var cancelledOccurrence = Assert.Single(cancelledState.Occurrences.Values);
            Assert.Equal(ScheduleStatus.Cancelled, cancelledState.Status);
            Assert.Equal(ScheduleOccurrenceStatus.Cancelled, cancelledOccurrence.Status);
            Assert.Null(cancelledState.PendingOccurrenceId);
            Assert.Equal(0, cancelledState.FireCount);
            Assert.Empty(cancelledState.FiredWork);

            var lateReplyRecorder = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "schedule-cancel-pending-late-terminal");
            actor.Tell(new ScheduleDeliveryCompleted(
                requested.OccurrenceId,
                new DeliveryState(
                    pendingOccurrence.DeliveryId,
                    new ActorAddress($"schedule/{scheduleId}", "local"),
                    "{}",
                    targetAddress,
                    pendingOccurrence.CommandId,
                    "payload-hash",
                    DeliveryStatus.Accepted,
                    1,
                    DateTimeOffset.UtcNow,
                    DateTimeOffset.UtcNow,
                    null),
                lateReplyRecorder));

            var lateReply = await WaitForMessageAsync<ScheduleNoOp>(lateReplyRecorder, TimeSpan.FromSeconds(3));
            Assert.Equal("terminal_occurrence_immutable", lateReply.Reason);

            var finalState = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(ScheduleStatus.Cancelled, finalState.Status);
            Assert.Equal(ScheduleOccurrenceStatus.Cancelled, Assert.Single(finalState.Occurrences.Values).Status);
            Assert.Equal(0, finalState.FireCount);
            Assert.Empty(finalState.FiredWork);
        });
    }

    [Fact]
    public async Task ScheduleDeliveryFailed_AfterTerminalAcceptedCancelledOrSkipped_IsIgnored()
    {
        await WithSystemWithResolver(async (system, resolver) =>
        {
            var acceptedDueAt = DateTimeOffset.UtcNow.AddMinutes(-5);
            var acceptedTarget = new ActorAddress("agent/scheduled-terminal-accepted", "local");
            var acceptedRecipient = system.ActorOf(Props.Create(() => new CapturingRecipientActor(acceptedTarget)), "scheduled-terminal-accepted-recipient");
            resolver.Register(acceptedTarget, acceptedRecipient);
            var acceptedActor = CreateScheduledWorkActor(system, "schedule-terminal-accepted", acceptedDueAt, null, MissedRunPolicy.RunImmediately, resolver, acceptedTarget, "research.run_digest", "{\"paperId\":\"P-TERM-ACCEPT\"}");

            _ = Assert.IsType<ScheduleDeliveryRequested>(await acceptedActor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3)));
            await AssertEventually(async () =>
            {
                var state = await acceptedActor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(ScheduleOccurrenceStatus.DeliveryAccepted, Assert.Single(state.Occurrences.Values).Status);
                Assert.Equal(1, state.FireCount);
            });

            var acceptedRecorder = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "scheduled-terminal-accepted-recorder");
            var acceptedOccurrenceId = CreateExpectedOccurrenceId("schedule-terminal-accepted", acceptedDueAt, "research.run_digest");
            acceptedActor.Tell(new ScheduleDeliveryFailed(
                acceptedOccurrenceId,
                new OperationError("scheduled_delivery_failed", "late accepted failure", true),
                acceptedRecorder));
            var acceptedNoOp = await WaitForMessageAsync<ScheduleNoOp>(acceptedRecorder, TimeSpan.FromSeconds(3));
            Assert.Equal("terminal_occurrence_immutable", acceptedNoOp.Reason);
            var acceptedState = await acceptedActor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(ScheduleOccurrenceStatus.DeliveryAccepted, Assert.Single(acceptedState.Occurrences.Values).Status);
            Assert.Equal(1, acceptedState.FireCount);

            var cancelledDueAt = DateTimeOffset.UtcNow.AddMinutes(-4);
            var cancelledTarget = new ActorAddress("agent/scheduled-terminal-cancelled", "local");
            var cancelledRecipient = system.ActorOf(Props.Create(() => new SlowAcceptingRecipientActor(cancelledTarget, TimeSpan.FromSeconds(10))), "scheduled-terminal-cancelled-recipient");
            resolver.Register(cancelledTarget, cancelledRecipient);
            var cancelledActor = CreateScheduledWorkActor(system, "schedule-terminal-cancelled", cancelledDueAt, null, MissedRunPolicy.RunImmediately, resolver, cancelledTarget, "research.run_digest", "{\"paperId\":\"P-TERM-CANCEL\"}");

            _ = Assert.IsType<ScheduleDeliveryRequested>(await cancelledActor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3)));
            _ = Assert.IsType<ScheduleCancellationAccepted>(await cancelledActor.Ask<object>(new CancelSchedule("cancelled"), TimeSpan.FromSeconds(3)));

            var cancelledRecorder = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "scheduled-terminal-cancelled-recorder");
            var cancelledOccurrenceId = CreateExpectedOccurrenceId("schedule-terminal-cancelled", cancelledDueAt, "research.run_digest");
            cancelledActor.Tell(new ScheduleDeliveryFailed(
                cancelledOccurrenceId,
                new OperationError("scheduled_delivery_failed", "late cancelled failure", true),
                cancelledRecorder));
            var cancelledNoOp = await WaitForMessageAsync<ScheduleNoOp>(cancelledRecorder, TimeSpan.FromSeconds(3));
            Assert.Equal("terminal_occurrence_immutable", cancelledNoOp.Reason);
            var cancelledState = await cancelledActor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(ScheduleOccurrenceStatus.Cancelled, Assert.Single(cancelledState.Occurrences.Values).Status);
            Assert.Equal(0, cancelledState.FireCount);

            var skippedDueAt = DateTimeOffset.UtcNow.AddMinutes(-3);
            var skippedActor = CreateScheduledWorkActor(system, "schedule-terminal-skipped", skippedDueAt, null, MissedRunPolicy.Skip, resolver, cancelledTarget, "research.run_digest", "{\"paperId\":\"P-TERM-SKIP\"}");
            _ = Assert.IsType<ScheduleSkipped>(await skippedActor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3)));

            var skippedRecorder = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "scheduled-terminal-skipped-recorder");
            var skippedOccurrenceId = CreateExpectedOccurrenceId("schedule-terminal-skipped", skippedDueAt, "research.run_digest");
            skippedActor.Tell(new ScheduleDeliveryFailed(
                skippedOccurrenceId,
                new OperationError("scheduled_delivery_failed", "late skipped failure", true),
                skippedRecorder));
            var skippedNoOp = await WaitForMessageAsync<ScheduleNoOp>(skippedRecorder, TimeSpan.FromSeconds(3));
            Assert.Equal("terminal_occurrence_immutable", skippedNoOp.Reason);
            var skippedState = await skippedActor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(ScheduleOccurrenceStatus.Skipped, Assert.Single(skippedState.Occurrences.Values).Status);
            Assert.Equal(0, skippedState.FireCount);
        });
    }

    [Fact]
    public async Task RestartAfterDueDetectionBeforeAcceptance_ResumesPendingDeliveryDeterministically()
    {
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        var targetAddress = new ActorAddress("agent/scheduled-restart", "local");

        await WithSystemWithResolver(async (system, resolver) =>
        {
            var actor = CreateScheduledWorkActor(system, "schedule-pending-restart", dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-RESTART\"}");

            var first = await actor.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(3));
            Assert.IsType<ScheduleDeliveryRequested>(first);

            var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(0, state.FireCount);
            Assert.NotNull(state.PendingOccurrenceId);
            Assert.Single(state.Occurrences);
            Assert.Equal(ScheduleOccurrenceStatus.DeliveryRequested, state.Occurrences.Values.Single().Status);
        });

        await WithSystemWithResolver(async (system, resolver) =>
        {
            var recipient = system.ActorOf(Props.Create(() => new CapturingRecipientActor(targetAddress)), "scheduled-restart-recipient");
            resolver.Register(targetAddress, recipient);

            var actor = CreateScheduledWorkActor(system, "schedule-pending-restart", dueAt, null, MissedRunPolicy.RunImmediately, resolver, targetAddress, "research.run_digest", "{\"paperId\":\"P-RESTART\"}");

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<ScheduleState>(new ScheduleInspect(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, state.FireCount);
                Assert.Single(state.FiredWork);
            }, attempts: 30, delayMs: 100);

            var delivery = await recipient.Ask<CapturedDelivery>(new GetCapturedDelivery(), TimeSpan.FromSeconds(3));
            Assert.Equal($"cmd-schedule-{CreateExpectedOccurrenceId("schedule-pending-restart", dueAt, "research.run_digest")}", delivery.CommandId);
            Assert.Equal(1, await recipient.Ask<int>(new GetAcceptedCommandCount(), TimeSpan.FromSeconds(3)));
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

        var system = ActorSystem.Create($"aven-phase15-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private async Task WithSystemWithResolver(Func<ActorSystem, LocalActorAddressRegistry, Task> action)
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

        var system = ActorSystem.Create($"aven-phase15-resolver-{Guid.NewGuid():N}", config);
        var resolver = new LocalActorAddressRegistry();
        try
        {
            await action(system, resolver);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static IActorRef CreateScheduledWorkActor(
        ActorSystem system,
        string persistenceId,
        DateTimeOffset dueAt,
        TimeSpan? recurrence,
        MissedRunPolicy missedRunPolicy,
        IActorAddressResolver? resolver = null,
        ActorAddress? targetAgent = null,
        string operationType = "schedule.fire",
        string payloadJson = "{\"task\":\"digest\"}")
    {
        var key = new OperationKey(new ActorAddress("schedule/owner", "local"), new RequestId(persistenceId), operationType);
        return system.ActorOf(
            Props.Create(() => new ScheduledWorkActor(
                persistenceId,
                persistenceId,
                key,
                new CorrelationId($"corr-{persistenceId}"),
                dueAt,
                recurrence,
                missedRunPolicy,
                payloadJson,
                targetAgent,
                operationType,
                resolver,
                targetAgent)),
            persistenceId.Replace('/', '-'));
    }

    private static string CreateExpectedOccurrenceId(string scheduleId, DateTimeOffset dueAt, string operationType)
    {
        var material = $"{scheduleId}|{dueAt:O}|{operationType}";
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(material));
        return Convert.ToHexString(bytes[..8]).ToLowerInvariant();
    }

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

    private static async Task<TMessage> WaitForMessageAsync<TMessage>(IActorRef recorder, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var messages = await recorder.Ask<object[]>(new GetRecordedReplies(), TimeSpan.FromSeconds(1));
            var match = messages.OfType<TMessage>().FirstOrDefault();
            if (match is not null)
            {
                return match;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"Timed out waiting for {typeof(TMessage).Name}.");
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private sealed record GetCapturedDelivery;
    private sealed record CapturedDelivery(string DeliveryId, string CommandId, string MessageId, string EnvelopeMessageType, string OperationType, string ValueJson);

    private sealed class CapturingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private CapturedDelivery? _captured;
        private int _acceptedCount;

        public CapturingRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer =>
            {
                var triggered = System.Text.Json.JsonSerializer.Deserialize<ScheduledWorkTriggered>(offer.Envelope.Payload)
                    ?? throw new InvalidOperationException("ScheduledWorkTriggered payload was empty.");
                _captured ??= new CapturedDelivery(
                    offer.DeliveryId.Value,
                    offer.Envelope.CommandId.Value,
                    offer.Envelope.MessageId.Value,
                    offer.Envelope.MessageType,
                    triggered.CommandType,
                    triggered.CommandJson);
                _acceptedCount++;
                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, _acceptedCount == 1 ? "accepted" : "duplicate"));
            });
            Receive<GetCapturedDelivery>(_ => Sender.Tell(_captured ?? throw new InvalidOperationException("No delivery captured yet.")));
            Receive<GetAcceptedCommandCount>(_ => Sender.Tell(_acceptedCount));
        }
    }

    private sealed class RejectingRecipientActor : ReceiveActor
    {
        public RejectingRecipientActor(ActorAddress address)
        {
            Receive<DeliveryAttemptOffer>(offer =>
            {
                Sender.Tell(new DeliveryRejected(
                    offer.DeliveryId,
                    offer.Envelope.CommandId,
                    address,
                    new OperationError("scheduled_delivery_rejected", "Scheduled target rejected the command.", false)));
            });
        }
    }

    private sealed class SlowAcceptingRecipientActor : ReceiveActor
    {
        public SlowAcceptingRecipientActor(ActorAddress address, TimeSpan delay)
        {
            ReceiveAsync<DeliveryAttemptOffer>(async offer =>
            {
                await Task.Delay(delay);
                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, address, "accepted"));
            });
        }
    }

    private sealed class DelayedCapturingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private readonly TimeSpan _delay;
        private CapturedDelivery? _captured;
        private int _acceptedCount;

        public DelayedCapturingRecipientActor(ActorAddress address, TimeSpan delay)
        {
            _address = address;
            _delay = delay;

            ReceiveAsync<DeliveryAttemptOffer>(async offer =>
            {
                var triggered = System.Text.Json.JsonSerializer.Deserialize<ScheduledWorkTriggered>(offer.Envelope.Payload)
                    ?? throw new InvalidOperationException("ScheduledWorkTriggered payload was empty.");
                _captured ??= new CapturedDelivery(
                    offer.DeliveryId.Value,
                    offer.Envelope.CommandId.Value,
                    offer.Envelope.MessageId.Value,
                    offer.Envelope.MessageType,
                    triggered.CommandType,
                    triggered.CommandJson);
                _acceptedCount++;
                await Task.Delay(_delay);
                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, _acceptedCount == 1 ? "accepted" : "duplicate"));
            });
            Receive<GetCapturedDelivery>(_ => Sender.Tell(_captured ?? throw new InvalidOperationException("No delivery captured yet.")));
            Receive<GetAcceptedCommandCount>(_ => Sender.Tell(_acceptedCount));
        }
    }

    private sealed record GetRecordedReplies;

    private sealed class ReplyRecorderActor : ReceiveActor
    {
        private readonly List<object> _messages = new();

        public ReplyRecorderActor()
        {
            Receive<GetRecordedReplies>(_ => Sender.Tell(_messages.ToArray()));
            ReceiveAny(message => _messages.Add(message));
        }
    }

    private sealed record GetAcceptedCommandCount;
}