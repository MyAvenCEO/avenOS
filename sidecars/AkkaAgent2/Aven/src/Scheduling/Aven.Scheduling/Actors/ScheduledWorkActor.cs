using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using Akka.Actor;
using Akka.Persistence;
using Aven.ActorKernel;
using Aven.Contracts.Protocol.Envelopes;
using Aven.Contracts.Protocol;
using Aven.DurableDelivery;

namespace Aven.Scheduling.Actors;

public sealed class ScheduledWorkActor : AvenPersistentActor
{
    private readonly string _scheduleId;
    private readonly OperationKey _operationKey;
    private readonly CorrelationId _correlationId;
    private readonly string _payloadJson;
    private readonly DateTimeOffset _dueAt;
    private readonly TimeSpan? _recurrence;
    private readonly MissedRunPolicy _missedRunPolicy;
    private readonly IActorAddressResolver? _resolver;
    private readonly DurableDeliveryFactory? _deliveryLauncher;
    private readonly ActorAddress? _targetAgent;
    private readonly string _targetOperationType;
    private readonly ActorAddress _scheduleAddress;
    private readonly Dictionary<DeliveryId, IActorRef> _deliveryReplies = new();
    private ScheduleState _state;
    private bool _scheduleRegistered;
    private bool _registeringSchedule;

    public ScheduledWorkActor(
        string persistenceId,
        string scheduleId,
        OperationKey operationKey,
        CorrelationId correlationId,
        DateTimeOffset dueAt,
        TimeSpan? recurrence,
        MissedRunPolicy missedRunPolicy,
        string payloadJson,
        ActorAddress? targetAgent = null,
        string? targetOperationType = null,
        IActorAddressResolver? resolver = null,
        ActorAddress? recipientAddress = null)
    {
        PersistenceId = persistenceId;
        _scheduleId = scheduleId;
        _operationKey = operationKey;
        _correlationId = correlationId;
        _dueAt = dueAt;
        _recurrence = recurrence;
        _missedRunPolicy = missedRunPolicy;
        _payloadJson = payloadJson;
        _targetAgent = targetAgent ?? recipientAddress;
        _targetOperationType = targetOperationType ?? operationKey.OperationType;
        _resolver = resolver;
        _deliveryLauncher = resolver is null ? null : new DurableDeliveryFactory(resolver);
        _scheduleAddress = new ActorAddress($"schedule/{_scheduleId}", "local");
        _state = ScheduleState.Create(scheduleId, operationKey, correlationId, dueAt, recurrence, missedRunPolicy);

        Command<InitializeSchedule>(_ =>
        {
            if (_scheduleRegistered || _registeringSchedule)
            {
                return;
            }

            _registeringSchedule = true;
            var evt = new ScheduleRegistered(
                _state.ScheduleId,
                _state.OperationKey,
                _state.CorrelationId,
                _state.DueAt,
                _state.Recurrence,
                _state.MissedRunPolicy);
            PersistEvent(evt, ScheduleMetadataFor<ScheduleRegistered>(evt, occurredAt: _dueAt), recorded =>
            {
                Apply(recorded);
                _registeringSchedule = false;
            });
        });

        Command<CheckScheduleDue>(HandleCheckDue);
        Command<CancelSchedule>(HandleCancel);
        Command<ScheduleDeliveryCompleted>(HandleDeliveryCompleted);
        Command<ScheduleDeliveryFailed>(HandleDeliveryFailed);
        Command<DeliveryTerminalSignal>(HandleTerminalNotification);
        Command<ScheduleInspect>(_ => Sender.Tell(_state));

        RecoverEvent<ScheduleRegistered>(Apply);
        RecoverEvent<ScheduleOccurrenceRecorded>(Apply);
        RecoverEvent<ScheduledRoleDeliveryRequested>(Apply);
        RecoverEvent<ScheduledRoleDeliveryAccepted>(Apply);
        RecoverEvent<ScheduledRoleDeliveryRejected>(Apply);
        RecoverEvent<ScheduleOccurrenceSkipped>(Apply);
        RecoverEvent<ScheduleMissedRunPromptRequested>(Apply);
        RecoverEvent<ScheduleOccurrenceCancelled>(Apply);
        RecoverEvent<ScheduleCancelled>(Apply);
        Recover<RecoveryCompleted>(_ =>
        {
            if (_resolver is IActorAddressRegistry registry)
            {
                registry.Register(_scheduleAddress, Self);
            }

            Self.Tell(new InitializeSchedule());

            if (_state.PendingOccurrenceId is { } pendingOccurrenceId
                && _state.Occurrences.TryGetValue(pendingOccurrenceId, out var pending)
                && pending.Status == ScheduleOccurrenceStatus.DeliveryRequested)
            {
                Self.Tell(new CheckScheduleDue(DateTimeOffset.UtcNow));
            }
        });
    }

    public override string PersistenceId { get; }

    private void HandleCheckDue(CheckScheduleDue command)
    {
        if (EnsureScheduleRegistered(command, Sender))
        {
            return;
        }

        if (_state.Status == ScheduleStatus.Cancelled)
        {
            Sender.Tell(new ScheduleNoOp("schedule_cancelled"));
            return;
        }

        if (_state.PendingOccurrenceId is { } pendingOccurrenceId
            && _state.Occurrences.TryGetValue(pendingOccurrenceId, out var pendingOccurrence)
            && pendingOccurrence.Status == ScheduleOccurrenceStatus.DeliveryRequested)
        {
            EnsureDeliveryInFlight(pendingOccurrence, Sender);
            Sender.Tell(new ScheduleNoOp("delivery_pending"));
            return;
        }

        var retryableRejectedOccurrence = FindRetryableRejectedOccurrence(command.Now);
        if (retryableRejectedOccurrence is not null)
        {
            RetryRejectedOccurrence(retryableRejectedOccurrence, Sender);
            return;
        }

        if (command.Now < _state.DueAt)
        {
            Sender.Tell(new ScheduleNoOp("not_due"));
            return;
        }

        var occurrenceId = CreateOccurrenceId(_scheduleId, _state.DueAt, _targetOperationType);
        if (_state.Occurrences.TryGetValue(occurrenceId, out var existingOccurrence))
        {
            switch (existingOccurrence.Status)
            {
                case ScheduleOccurrenceStatus.DeliveryAccepted:
                case ScheduleOccurrenceStatus.Skipped:
                case ScheduleOccurrenceStatus.Cancelled:
                    Sender.Tell(new ScheduleNoOp("already_processed"));
                    return;
                case ScheduleOccurrenceStatus.DeliveryRequested:
                    EnsureDeliveryInFlight(existingOccurrence, Sender);
                    Sender.Tell(new ScheduleNoOp("delivery_pending"));
                    return;
                case ScheduleOccurrenceStatus.DeliveryRejected:
                    RetryRejectedOccurrence(existingOccurrence, Sender);
                    return;
            }
        }

        if (_state.LastCompletedDueAt == _state.DueAt)
        {
            Sender.Tell(new ScheduleNoOp("already_processed"));
            return;
        }

        if (_state.MissedRunPolicy == MissedRunPolicy.Skip && command.Now > _state.DueAt)
        {
            var skipReplyTo = Sender;
            var nextDueAt = ComputeNextDueAt(_state.DueAt);
            var skippedEvt = new ScheduleOccurrenceSkipped(
                _scheduleId,
                occurrenceId,
                _state.DueAt,
                command.Now,
                "missed_run_skipped",
                nextDueAt);
            PersistEvent(skippedEvt, ScheduleMetadataFor<ScheduleOccurrenceSkipped>(skippedEvt, skippedEvt, occurredAt: skippedEvt.SkippedAt), recorded =>
            {
                Apply(recorded);
                skipReplyTo.Tell(new ScheduleSkipped(_scheduleId, occurrenceId, recorded.DueAt, recorded.SkippedAt, recorded.Reason, recorded.NextDueAt));
            });
            return;
        }

        if (_state.MissedRunPolicy == MissedRunPolicy.AskUser && command.Now > _state.DueAt)
        {
            var sender = Sender;
            var nextDueAt = ComputeNextDueAt(_state.DueAt);
            var promptText = $"Schedule '{_scheduleId}' missed its due time at {_state.DueAt:O}. Should it run now?";
            var evt = new ScheduleMissedRunPromptRequested(_state.DueAt, command.Now, promptText, nextDueAt);
            PersistEvent(evt, ScheduleMetadataFor<ScheduleMissedRunPromptRequested>(evt, evt, occurredAt: command.Now), recorded =>
        {
            Apply(recorded);
            sender.Tell(new SchedulePromptRequested(_scheduleId, promptText, nextDueAt));
        });

            return;
        }
        var firedAt = command.Now;
        var workItemPayloadJson = JsonSerializer.Serialize(new
        {
            scheduleId = _scheduleId,
            correlationId = _correlationId.Value,
            operationType = _operationKey.OperationType,
            payload = _payloadJson
        });
        var workItem = new ScheduledWorkItem(
            _state.Recurrence is null ? "delivery" : "delivery.recurring",
            _state.DueAt,
            firedAt,
            workItemPayloadJson,
            PersistedCommandPayload.ComputeHash(workItemPayloadJson),
            Encoding.UTF8.GetByteCount(workItemPayloadJson));

        var replyTo = Sender;
        var next = ComputeNextDueAt(_state.DueAt);
        var occurrence = CreateOccurrence(occurrenceId, _state.DueAt, firedAt, workItem);
        var detected = new ScheduleOccurrenceRecorded(
            _scheduleId,
            occurrence.OccurrenceId,
            occurrence.DueAt,
            occurrence.DetectedAt,
            occurrence.WorkItem,
            occurrence.WorkItem.PayloadHash,
            occurrence.WorkItem.PayloadSizeBytes,
            occurrence.DeliveryId,
            occurrence.CommandId,
            occurrence.MessageId,
            next);
        PersistEvent(detected, ScheduleMetadataFor<ScheduleOccurrenceRecorded>(detected, detected, deliveryId: detected.DeliveryId, occurredAt: firedAt), dueRecorded =>
        {
            Apply(dueRecorded);
            var occurrence = _state.Occurrences[occurrenceId];

            if (_resolver is null || _targetAgent is null)
            {
                var acceptedEvt = new ScheduledRoleDeliveryAccepted(occurrenceId, occurrence.DeliveryId, occurrence.DetectedAt, "local_acceptance", next);
                PersistEvent(acceptedEvt, ScheduleMetadataFor<ScheduledRoleDeliveryAccepted>(acceptedEvt, acceptedEvt, deliveryId: occurrence.DeliveryId), acceptedRecorded =>
                {
                    Apply(acceptedRecorded);
                    replyTo.Tell(new ScheduleFired(_scheduleId, workItem, next, occurrenceId));
                });
                return;
            }

            var requestedEvt = new ScheduledRoleDeliveryRequested(occurrenceId, occurrence.DeliveryId);
            PersistEvent(requestedEvt, ScheduleMetadataFor<ScheduledRoleDeliveryRequested>(requestedEvt, requestedEvt, deliveryId: occurrence.DeliveryId), requestedRecorded =>
            {
                Apply(requestedRecorded);
                StartOccurrenceDelivery(_state.Occurrences[occurrenceId], replyTo);
                replyTo.Tell(new ScheduleDeliveryRequested(_scheduleId, occurrenceId, workItem, next));
            });
        });
    }

    private void HandleCancel(CancelSchedule command)
    {
        if (EnsureScheduleRegistered(command, Sender))
        {
            return;
        }

        if (_state.Status == ScheduleStatus.Cancelled)
        {
            Sender.Tell(new ScheduleCancellationAccepted(_scheduleId, command.Reason, true));
            return;
        }

        var replyTo = Sender;
        var cancelledAt = command.CancelledAt ?? DateTimeOffset.UtcNow;
        var cancellableOccurrence = FindCancellableOccurrence();
        if (cancellableOccurrence is not null)
        {
            _deliveryReplies.Remove(cancellableOccurrence.DeliveryId);
            var cancelledOccurrenceEvt = new ScheduleOccurrenceCancelled(
                cancellableOccurrence.OccurrenceId,
                cancellableOccurrence.DeliveryId,
                cancelledAt,
                command.Reason);
            PersistEvent(cancelledOccurrenceEvt, ScheduleMetadataFor<ScheduleOccurrenceCancelled>(cancelledOccurrenceEvt, cancelledOccurrenceEvt, deliveryId: cancellableOccurrence.DeliveryId, occurredAt: cancelledAt), occurrenceRecorded =>
            {
                Apply(occurrenceRecorded);
                PersistScheduleCancellation(replyTo, command.Reason, cancelledAt);
            });
            return;
        }

        PersistScheduleCancellation(replyTo, command.Reason, cancelledAt);
    }

    private void HandleDeliveryCompleted(ScheduleDeliveryCompleted completed)
    {
        if (EnsureScheduleRegistered(completed, Sender))
        {
            return;
        }

        if (!_state.Occurrences.TryGetValue(completed.OccurrenceId, out var occurrence))
        {
            completed.ReplyTo.Tell(new ScheduleNoOp("unknown_occurrence"));
            return;
        }

        if (occurrence.Status != ScheduleOccurrenceStatus.DeliveryRequested)
        {
            completed.ReplyTo.Tell(new ScheduleNoOp("terminal_occurrence_immutable"));
            return;
        }

        if (completed.Terminal.DeliveryId != occurrence.DeliveryId)
        {
            completed.ReplyTo.Tell(new ScheduleNoOp("stale_delivery_terminal"));
            return;
        }

        var next = ComputeNextDueAt(occurrence.DueAt);
        if (completed.Terminal.Status == DeliveryStatus.Accepted)
        {
            var evt = new ScheduledRoleDeliveryAccepted(
                completed.OccurrenceId,
                completed.Terminal.DeliveryId,
                completed.Terminal.AcceptedAt,
                "recipient_accepted",
                next);
            PersistEvent(evt, ScheduleMetadataFor<ScheduledRoleDeliveryAccepted>(evt, evt, deliveryId: completed.Terminal.DeliveryId), recorded =>
            {
                Apply(recorded);
                completed.ReplyTo.Tell(new ScheduleFired(_scheduleId, occurrence.WorkItem, next, completed.OccurrenceId));
            });
            return;
        }

        var error = completed.Terminal.TerminalError ?? new OperationError("schedule_delivery_not_accepted", $"Scheduled delivery ended with status {completed.Terminal.Status}.", false);
        var rejectedEvt = new ScheduledRoleDeliveryRejected(completed.OccurrenceId, completed.Terminal.DeliveryId, error, next);
        PersistEvent(rejectedEvt, ScheduleMetadataFor<ScheduledRoleDeliveryRejected>(rejectedEvt, rejectedEvt, deliveryId: completed.Terminal.DeliveryId), recorded =>
        {
            Apply(recorded);
            completed.ReplyTo.Tell(new ScheduleNoOp("delivery_rejected"));
        });
    }

    private void HandleDeliveryFailed(ScheduleDeliveryFailed failed)
    {
        if (EnsureScheduleRegistered(failed, Sender))
        {
            return;
        }

        if (!_state.Occurrences.TryGetValue(failed.OccurrenceId, out var occurrence))
        {
            failed.ReplyTo.Tell(new ScheduleNoOp("unknown_occurrence"));
            return;
        }

        if (occurrence.Status != ScheduleOccurrenceStatus.DeliveryRequested)
        {
            failed.ReplyTo.Tell(new ScheduleNoOp("terminal_occurrence_immutable"));
            return;
        }

        var next = ComputeNextDueAt(occurrence.DueAt);
        var evt = new ScheduledRoleDeliveryRejected(failed.OccurrenceId, occurrence.DeliveryId, failed.Error, next);
        PersistEvent(evt, ScheduleMetadataFor<ScheduledRoleDeliveryRejected>(evt, evt, deliveryId: occurrence.DeliveryId), recorded =>
        {
            Apply(recorded);
            failed.ReplyTo.Tell(new ScheduleNoOp("delivery_failed"));
        });
    }

    private void Apply(ScheduleRegistered recorded)
    {
        _scheduleRegistered = true;
        _state = ScheduleState.Create(
            recorded.ScheduleId,
            recorded.OperationKey,
            recorded.CorrelationId,
            recorded.DueAt,
            recorded.Recurrence,
            recorded.MissedRunPolicy);
    }

    private void Apply(ScheduleOccurrenceRecorded recorded)
    {
        var occurrences = _state.Occurrences.ToDictionary(static x => x.Key, static x => x.Value, StringComparer.Ordinal);
        occurrences[recorded.OccurrenceId] = new ScheduleOccurrenceState(
            recorded.OccurrenceId,
            recorded.DueAt,
            recorded.DetectedAt,
            recorded.WorkItem,
            recorded.DeliveryId,
            recorded.CommandId,
            recorded.MessageId,
            0,
            ScheduleOccurrenceStatus.DueDetected,
            null,
            null);
        _state = _state with
        {
            Occurrences = occurrences,
            PendingOccurrenceId = recorded.OccurrenceId,
            DueAt = recorded.NextDueAt ?? _state.DueAt,
            PendingPrompt = null,
            DueCount = _state.DueCount + 1
        };
    }

    private void Apply(ScheduledRoleDeliveryRequested recorded)
    {
        if (!_state.Occurrences.TryGetValue(recorded.OccurrenceId, out var occurrence))
        {
            return;
        }

        var occurrences = _state.Occurrences.ToDictionary(static x => x.Key, static x => x.Value, StringComparer.Ordinal);
        occurrences[recorded.OccurrenceId] = occurrence with
        {
            DeliveryId = recorded.DeliveryId,
            DeliveryAttemptCount = occurrence.DeliveryAttemptCount + 1,
            Status = ScheduleOccurrenceStatus.DeliveryRequested,
            Delivery = null,
            Error = null
        };
        _state = _state with { Occurrences = occurrences, PendingOccurrenceId = recorded.OccurrenceId };
    }

    private void Apply(ScheduledRoleDeliveryAccepted recorded)
    {
        if (!_state.Occurrences.TryGetValue(recorded.OccurrenceId, out var occurrence))
        {
            return;
        }

        var occurrences = _state.Occurrences.ToDictionary(static x => x.Key, static x => x.Value, StringComparer.Ordinal);
        var delivery = new ScheduledDeliveryReceipt(
            recorded.DeliveryId,
            DeliveryStatus.Accepted,
            recorded.AcceptedAt,
            recorded.AcceptanceKind,
            null);
        occurrences[recorded.OccurrenceId] = occurrence with
        {
            Status = ScheduleOccurrenceStatus.DeliveryAccepted,
            Delivery = delivery,
            Error = null
        };
        var firedWork = _state.FiredWork.ToList();
        firedWork.Add(occurrence.WorkItem);
        _state = _state with
        {
            Occurrences = occurrences,
            PendingOccurrenceId = null,
            DueAt = recorded.NextDueAt ?? _state.DueAt,
            LastCompletedDueAt = occurrence.DueAt,
            LastAcceptedDueAt = occurrence.DueAt,
            FiredWork = firedWork,
            PendingPrompt = null,
            FireCount = _state.FireCount + 1
        };
    }

    private void Apply(ScheduledRoleDeliveryRejected recorded)
    {
        if (!_state.Occurrences.TryGetValue(recorded.OccurrenceId, out var occurrence))
        {
            return;
        }

        var occurrences = _state.Occurrences.ToDictionary(static x => x.Key, static x => x.Value, StringComparer.Ordinal);
        var delivery = new ScheduledDeliveryReceipt(
            recorded.DeliveryId,
            DeliveryStatus.Rejected,
            null,
            null,
            recorded.Error);
        occurrences[recorded.OccurrenceId] = occurrence with
        {
            Status = ScheduleOccurrenceStatus.DeliveryRejected,
            Delivery = delivery,
            Error = recorded.Error
        };
        _state = _state with
        {
            Occurrences = occurrences,
            PendingOccurrenceId = null,
            PendingPrompt = null
        };
    }

    private void Apply(ScheduleOccurrenceSkipped recorded)
    {
        var occurrences = _state.Occurrences.ToDictionary(static x => x.Key, static x => x.Value, StringComparer.Ordinal);
        var workItem = new ScheduledWorkItem(
            ResourceOperationTypes.ScheduleSkipped,
            recorded.DueAt,
            recorded.SkippedAt,
            "{}",
            string.Empty,
            0);
        var deliveryId = DeliveryIdForAttempt(recorded.OccurrenceId, 1);
        occurrences[recorded.OccurrenceId] = new ScheduleOccurrenceState(
            recorded.OccurrenceId,
            recorded.DueAt,
            recorded.SkippedAt,
            workItem,
            deliveryId,
            new CommandId($"cmd-schedule-{recorded.OccurrenceId}"),
            new MessageId($"msg-schedule-{recorded.OccurrenceId}"),
            0,
            ScheduleOccurrenceStatus.Skipped,
            null,
            new OperationError(recorded.Reason, "The missed schedule occurrence was skipped.", false));
        _state = _state with
        {
            Occurrences = occurrences,
            PendingOccurrenceId = null,
            DueAt = recorded.NextDueAt ?? _state.DueAt,
            LastCompletedDueAt = recorded.DueAt,
            PendingPrompt = null,
            DueCount = _state.DueCount + 1
        };
    }

    private void Apply(ScheduleMissedRunPromptRequested recorded)
    {
        _state = _state with
        {
            DueAt = recorded.NextDueAt ?? _state.DueAt,
            LastCompletedDueAt = recorded.OccurrenceDueAt,
            PendingPrompt = recorded.PromptText
        };
    }

    private void Apply(ScheduleOccurrenceCancelled recorded)
    {
        if (!_state.Occurrences.TryGetValue(recorded.OccurrenceId, out var occurrence))
        {
            return;
        }

        var occurrences = _state.Occurrences.ToDictionary(static x => x.Key, static x => x.Value, StringComparer.Ordinal);
        occurrences[recorded.OccurrenceId] = occurrence with
        {
            Status = ScheduleOccurrenceStatus.Cancelled,
            Error = new OperationError("schedule_cancelled", recorded.Reason, false)
        };
        _state = _state with
        {
            Occurrences = occurrences,
            PendingOccurrenceId = null,
            PendingPrompt = null,
            LastCompletedDueAt = occurrence.DueAt
        };
    }

    private void Apply(ScheduleCancelled _)
    {
        _state = _state with { Status = ScheduleStatus.Cancelled };
    }

    private ScheduleOccurrenceState CreateOccurrence(string occurrenceId, DateTimeOffset dueAt, DateTimeOffset detectedAt, ScheduledWorkItem workItem) =>
        new(
            occurrenceId,
            dueAt,
            detectedAt,
            workItem,
            DeliveryIdForAttempt(occurrenceId, 1),
            new CommandId($"cmd-schedule-{occurrenceId}"),
            new MessageId($"msg-schedule-{occurrenceId}"),
            0,
            ScheduleOccurrenceStatus.DueDetected,
            null,
            null);

    private bool EnsureScheduleRegistered(object command, IActorRef replyTo)
    {
        if (_scheduleRegistered)
        {
            return false;
        }

        if (_registeringSchedule)
        {
            Self.Tell(command, replyTo);
            return true;
        }

        Self.Tell(new InitializeSchedule(), replyTo);
        Self.Tell(command, replyTo);
        return true;
    }

    private void EnsureDeliveryInFlight(ScheduleOccurrenceState occurrence, IActorRef replyTo)
    {
        StartOccurrenceDelivery(occurrence, replyTo);
    }

    private ScheduleOccurrenceState? FindRetryableRejectedOccurrence(DateTimeOffset now) =>
        _state.Occurrences.Values
            .Where(x => x.Status == ScheduleOccurrenceStatus.DeliveryRejected && x.DueAt <= now)
            .OrderBy(x => x.DueAt)
            .ThenBy(x => x.DetectedAt)
            .FirstOrDefault();

    private ScheduleOccurrenceState? FindCancellableOccurrence()
    {
        if (_state.PendingOccurrenceId is { } pendingOccurrenceId
            && _state.Occurrences.TryGetValue(pendingOccurrenceId, out var pending)
            && pending.Status == ScheduleOccurrenceStatus.DeliveryRequested)
        {
            return pending;
        }

        return _state.Occurrences.Values
            .Where(x => x.DueAt == _state.DueAt && x.Status is ScheduleOccurrenceStatus.DeliveryRequested or ScheduleOccurrenceStatus.DeliveryRejected)
            .OrderByDescending(x => x.DetectedAt)
            .FirstOrDefault();
    }

    private void RetryRejectedOccurrence(ScheduleOccurrenceState occurrence, IActorRef replyTo)
    {
        var nextAttempt = occurrence.DeliveryAttemptCount + 1;
        var nextDeliveryId = DeliveryIdForAttempt(occurrence.OccurrenceId, nextAttempt);
        var requestedEvt = new ScheduledRoleDeliveryRequested(occurrence.OccurrenceId, nextDeliveryId);
        PersistEvent(requestedEvt, ScheduleMetadataFor<ScheduledRoleDeliveryRequested>(requestedEvt, requestedEvt, deliveryId: nextDeliveryId), requestedRecorded =>
        {
            Apply(requestedRecorded);
            StartOccurrenceDelivery(_state.Occurrences[occurrence.OccurrenceId], replyTo);
            replyTo.Tell(new ScheduleDeliveryRequested(_scheduleId, occurrence.OccurrenceId, occurrence.WorkItem, ComputeNextDueAt(occurrence.DueAt)));
        });
    }

    private void PersistScheduleCancellation(IActorRef replyTo, string reason, DateTimeOffset cancelledAt)
    {
        var evt = new ScheduleCancelled(cancelledAt, reason);
        PersistEvent(evt, ScheduleMetadataFor<ScheduleCancelled>(evt, evt, occurredAt: evt.CancelledAt), recorded =>
        {
            Apply(recorded);
            replyTo.Tell(new ScheduleCancellationAccepted(_scheduleId, reason, false));
        });
    }

    private void StartOccurrenceDelivery(ScheduleOccurrenceState occurrence, IActorRef replyTo)
    {
        if (_resolver is null || _targetAgent is null)
        {
            return;
        }

        var payload = JsonSerializer.Serialize(new ScheduledWorkTriggered(
            _scheduleId,
            occurrence.OccurrenceId,
            _targetOperationType,
            _payloadJson,
            occurrence.DueAt,
            occurrence.DetectedAt));
        var targetAgent = _targetAgent ?? throw new InvalidOperationException("Schedule delivery target is unavailable.");
        var envelope = AvenEnvelopeBuilder
            .ForMessage(ScheduledWorkTriggered.MessageType, payload)
            .From(_scheduleAddress)
            .To(targetAgent)
            .ReplyTo(_scheduleAddress)
            .WithCorrelation(_correlationId)
            .WithCommandId(occurrence.CommandId)
            .WithMessageId(occurrence.MessageId)
            .WithCreatedAt(occurrence.DetectedAt)
            .Build();

        if (!replyTo.IsNobody())
        {
            _deliveryReplies[occurrence.DeliveryId] = replyTo;
        }

        (_deliveryLauncher ?? throw new InvalidOperationException("Schedule delivery launcher is unavailable."))
            .StartOrResume(
                Context,
                PersistenceId,
                DurableDeliveryStartFactory.ForEnvelope(envelope)
                    .OwnedBy(_scheduleAddress)
                    .WithDeliveryId(occurrence.DeliveryId)
                    .WithPolicy(new DeliveryPolicy(TimeSpan.FromSeconds(1), int.MaxValue))
                    .NotifyTerminal(_scheduleAddress)
                    .Build());
    }

    private void HandleTerminalNotification(DeliveryTerminalSignal notification)
    {
        var occurrence = _state.Occurrences.Values.FirstOrDefault(x => x.DeliveryId == notification.DeliveryId);
        if (occurrence is null)
        {
            return;
        }

        IActorRef replyTo = ActorRefs.Nobody;
        if (_deliveryReplies.TryGetValue(notification.DeliveryId, out var pendingReply) && pendingReply is not null)
        {
            replyTo = pendingReply;
        }

        _deliveryReplies.Remove(notification.DeliveryId);
        Self.Tell(new ScheduleDeliveryCompleted(occurrence.OccurrenceId, notification.State, replyTo));
    }

    private DateTimeOffset? ComputeNextDueAt(DateTimeOffset currentDueAt) =>
        _recurrence is { } recurrence ? currentDueAt.Add(recurrence) : null;

    private static string CreateOccurrenceId(string scheduleId, DateTimeOffset dueAt, string targetOperationType)
    {
        var material = $"{scheduleId}|{dueAt:O}|{targetOperationType}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return Convert.ToHexString(bytes[..8]).ToLowerInvariant();
    }

    private static DeliveryId DeliveryIdForAttempt(string occurrenceId, int attemptNumber) =>
        attemptNumber <= 1
            ? new DeliveryId($"delivery-schedule-{occurrenceId}")
            : new DeliveryId($"delivery-schedule-{occurrenceId}-retry-{attemptNumber}");

    private EventMetadata ScheduleMetadataFor<TEvent>(object? payloadForHash = null, object? metadataPayload = null, DeliveryId? deliveryId = null, DateTimeOffset? occurredAt = null)
        where TEvent : IAvenEvent =>
        MetadataFor<TEvent>(
            new ActorAddress($"schedule/{_scheduleId}", "local"),
            nameof(ScheduledWorkActor),
            _correlationId,
            metadataPayload ?? payloadForHash,
            deliveryId: deliveryId,
            operationKey: _operationKey,
            occurredAt: occurredAt);

}
