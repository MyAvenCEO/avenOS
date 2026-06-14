using System.Text.Json;
using Akka.Actor;
using Akka.Persistence;
using Aven.ActorKernel;
using Aven.ActorKernel.Addressing;

namespace Aven.Resources.Human.Actors;

public sealed class HumanPromptActor : AvenPersistentActor, IWithTimers
{
    private const string ExpiryTimerKey = "human-prompt-expiry";

    private sealed record HumanPromptAnswerCapabilityCompleted(HumanPromptAnswer Command, IActorRef ReplyTo, object Admission);
    private sealed record HumanPromptAnswerCapabilityErrored(HumanPromptAnswer Command, IActorRef ReplyTo, Exception Exception);
    private sealed record HumanPromptExpiryDue(DateTimeOffset Deadline);

    private readonly PromptId _promptId;
    private readonly OperationKey _key;
    private readonly CorrelationId _correlationId;
    private readonly ActorAddress _adapter;
    private readonly string _promptText;
    private readonly DateTimeOffset? _expiresAt;
    private readonly string? _capabilityId;
    private readonly ICapabilityAdmissionClient? _capabilityAuthority;
    private readonly ActorAddress _capabilityTarget;
    private readonly IActorAddressResolver? _resolver;
    private HumanPromptState _state;

    public HumanPromptActor(
        string persistenceId,
        OperationKey key,
        CorrelationId correlationId,
        ActorAddress adapter,
        string promptText,
        DateTimeOffset? expiresAt = null,
        string? capabilityId = null,
        ICapabilityAdmissionClient? capabilityAuthority = null,
        ActorAddress? capabilityTarget = null,
        IActorAddressResolver? resolver = null)
    {
        PersistenceId = persistenceId;
        _key = key;
        _correlationId = correlationId;
        _adapter = adapter;
        _promptText = promptText;
        _expiresAt = expiresAt;
        _capabilityId = capabilityId;
        _capabilityAuthority = capabilityAuthority;
        _capabilityTarget = capabilityTarget ?? ResourceAddresses.Gateway(ResourceKinds.Human);
        _resolver = resolver;
        _promptId = HumanPromptIdentity.FromOperationKey(key);
        _state = HumanPromptState.Create(_promptId, key, correlationId, adapter, promptText, expiresAt, capabilityId);

        Command<InitializeHumanPrompt>(_ => EnsureRegistered(ActorRefs.Nobody, shouldReply: false));

        Command<HumanPromptAnswer>(HandleAnswer);
        Command<HumanPromptAnswerCapabilityCompleted>(completed =>
        {
            if (completed.Admission is CapabilityRejected rejected)
            {
                completed.ReplyTo.Tell(new HumanPromptAnswerRejected(_promptId, rejected.Error));
                return;
            }

            HandleAnswerAfterAdmission(completed.Command, completed.ReplyTo);
        });
        Command<HumanPromptAnswerCapabilityErrored>(failed =>
            failed.ReplyTo.Tell(new HumanPromptAnswerRejected(
                _promptId,
                new OperationError("capability_admission_failed", failed.Exception.Message, true))));
        Command<HumanPromptCancel>(HandleCancel);
        Command<HumanPromptEnsureRegistered>(_ => EnsureRegistered(Sender, shouldReply: true));
        Command<HumanPromptInspect>(_ => Sender.Tell(_state));
        Command<HumanPromptGetOperationReply>(_ => Sender.Tell(CreateOperationReply()));
        Command<HumanPromptTerminalReplyAcknowledged>(HandleTerminalReplyAcknowledged);
        Command<HumanPromptExpiryDue>(due => TryExpirePrompt(due.Deadline, DateTimeOffset.UtcNow));

        RecoverEvent<HumanPromptRegistered>(Apply);
        RecoverEvent<HumanPromptAnswered>(Apply);
        RecoverEvent<HumanPromptCancelled>(Apply);
        RecoverEvent<HumanPromptExpired>(Apply);
        RecoverEvent<HumanPromptLateAnswerRecorded>(Apply);
        RecoverEvent<HumanPromptTerminalReplyAcked>(Apply);
        Recover<RecoveryCompleted>(_ =>
        {
            if (LastSequenceNr == 0)
            {
                Self.Tell(new InitializeHumanPrompt());
                return;
            }

            ScheduleExpiryIfNeeded();
            PublishTerminalReplyIfPossible();
        });
    }

    public override string PersistenceId { get; }
    public ITimerScheduler Timers { get; set; } = null!;

    private void EnsureRegistered(IActorRef replyTo, bool shouldReply)
    {
        if (LastSequenceNr == 0)
        {
            var evt = new HumanPromptRegistered(_promptId, _key, _correlationId, _adapter, _promptText, _expiresAt, _capabilityId);
            PersistEvent(evt, MetadataFor<HumanPromptRegistered>(
                new ActorAddress($"human-prompt/{_promptId.Value}", "local"),
                nameof(HumanPromptActor),
                _correlationId,
                evt,
                operationKey: _key), persisted =>
            {
                Apply(persisted);
                ScheduleExpiryIfNeeded();
                if (shouldReply)
                {
                    replyTo.Tell(_state);
                }
            });
            return;
        }

        if (shouldReply)
        {
            replyTo.Tell(_state);
        }
    }

    private void HandleAnswer(HumanPromptAnswer command)
    {
        if (command.PromptId != _promptId)
        {
            Sender.Tell(new HumanPromptAnswerRejected(
                _promptId,
                new OperationError("prompt_id_mismatch", "Human prompt answers must target the prompt by PromptId.", false)));
            return;
        }

        if (_state.Status == HumanPromptStatus.Cancelled)
        {
            Sender.Tell(new HumanPromptAnswerRejected(
                _promptId,
                new OperationError("prompt_cancelled", "The prompt was cancelled and can no longer be answered.", false)));
            return;
        }

        if (_capabilityAuthority is not null)
        {
            if (command.CapabilityId is not { } capabilityId)
            {
                Sender.Tell(new HumanPromptAnswerRejected(
                    _promptId,
                    new OperationError("capability_required", "Human prompt answers require a capability id.", false)));
                return;
            }

            StartCapabilityAdmissionAsync(command, Sender, new CapabilityAdmissionRequest(
                capabilityId,
                _key,
                _capabilityTarget,
                ResourceOperationTypes.HumanApprove,
                command.AnsweredAt ?? DateTimeOffset.UtcNow));
            return;
        }

        HandleAnswerAfterAdmission(command, Sender);
    }

    private void StartCapabilityAdmissionAsync(HumanPromptAnswer command, IActorRef replyTo, CapabilityAdmissionRequest request)
    {
        var self = Self;
        _ = _capabilityAuthority!.AdmitAsync(request)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new HumanPromptAnswerCapabilityCompleted(command, replyTo, task.Result)
                    : new HumanPromptAnswerCapabilityErrored(command, replyTo, task.Exception?.GetBaseException() ?? new InvalidOperationException("Capability admission failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(task.Result), TaskScheduler.Default);
    }

    private void HandleAnswerAfterAdmission(HumanPromptAnswer command, IActorRef replyTo)
    {
        if (command.PromptId != _promptId)
        {
            replyTo.Tell(new HumanPromptAnswerRejected(
                _promptId,
                new OperationError("prompt_id_mismatch", "Human prompt answers must target the prompt by PromptId.", false)));
            return;
        }

        if (_state.Status == HumanPromptStatus.Cancelled)
        {
            replyTo.Tell(new HumanPromptAnswerRejected(
                _promptId,
                new OperationError("prompt_cancelled", "The prompt was cancelled and can no longer be answered.", false)));
            return;
        }

        var answerAt = command.AnsweredAt ?? DateTimeOffset.UtcNow;

        if (_state.Status == HumanPromptStatus.Answered)
        {
            if (StringComparer.Ordinal.Equals(_state.Answer, command.Answer))
            {
                replyTo.Tell(new HumanPromptAnswerAccepted(_promptId, command.Answer, true, false));
                return;
            }

            replyTo.Tell(new HumanPromptAnswerConflict(
                _promptId,
                new OperationError("prompt_answer_conflict", "A different answer was already recorded for this prompt.", false)));
            return;
        }

        if (_state.Status == HumanPromptStatus.Expired || (_state.ExpiresAt is { } expiresAt && answerAt > expiresAt))
        {
            if (_state.Status != HumanPromptStatus.Expired)
            {
                var expired = new HumanPromptExpired(_promptId, answerAt);
                PersistEvent(expired, PromptMetadataFor<HumanPromptExpired>(expired, occurredAt: answerAt), persisted =>
                {
                    Apply(persisted);
                    Timers.Cancel(ExpiryTimerKey);
                    PublishTerminalReplyIfPossible();
                });
            }

            var late = new HumanPromptLateAnswerRecorded(_promptId, command.Answer, answerAt);
            PersistEvent(late, PromptMetadataFor<HumanPromptLateAnswerRecorded>(late, occurredAt: answerAt), lateRecorded =>
            {
                Apply(lateRecorded);
                replyTo.Tell(new HumanPromptAnswerRejected(
                    _promptId,
                    new OperationError("prompt_expired", "The prompt has expired; the answer was recorded as late input.", false)));
            });
            return;
        }

        var answered = new HumanPromptAnswered(_promptId, command.Answer, answerAt);
        PersistEvent(answered, PromptMetadataFor<HumanPromptAnswered>(answered, occurredAt: answerAt), persisted =>
        {
            Apply(persisted);
            PublishTerminalReplyIfPossible();
            replyTo.Tell(new HumanPromptAnswerAccepted(_promptId, command.Answer, false, false));
        });
    }

    private void HandleCancel(HumanPromptCancel command)
    {
        if (command.PromptId != _promptId)
        {
            Sender.Tell(new HumanPromptCancellationRejected(
                _promptId,
                new OperationError("prompt_id_mismatch", "Human prompt cancellation must target the prompt by PromptId.", false)));
            return;
        }

        if (string.IsNullOrWhiteSpace(command.Reason))
        {
            Sender.Tell(new HumanPromptCancellationRejected(
                _promptId,
                new OperationError("missing_cancel_reason", "Human prompt cancellation requires a non-empty reason.", false)));
            return;
        }

        if (_state.Status == HumanPromptStatus.Cancelled)
        {
            Sender.Tell(new HumanPromptCancellationAccepted(_promptId, _state.CancelReason ?? command.Reason, true));
            return;
        }

        if (_state.Status != HumanPromptStatus.Open)
        {
            Sender.Tell(new HumanPromptCancellationRejected(
                _promptId,
                new OperationError("prompt_not_open", $"Prompt cannot be cancelled while in status '{_state.Status}'.", false)));
            return;
        }

        var replyTo = Sender;
        var cancelled = new HumanPromptCancelled(_promptId, command.Reason, command.CancelledAt ?? DateTimeOffset.UtcNow);
        PersistEvent(cancelled, PromptMetadataFor<HumanPromptCancelled>(cancelled, occurredAt: cancelled.CancelledAt), persisted =>
        {
            Apply(persisted);
            Timers.Cancel(ExpiryTimerKey);
            PublishTerminalReplyIfPossible();
            replyTo.Tell(new HumanPromptCancellationAccepted(_promptId, cancelled.Reason, false));
        });
    }

    private void HandleTerminalReplyAcknowledged(HumanPromptTerminalReplyAcknowledged acknowledged)
    {
        if (acknowledged.PromptId != _promptId || _state.TerminalReplyAcknowledged || !_state.TerminalReplyPending)
        {
            return;
        }

        var evt = new HumanPromptTerminalReplyAcked(_promptId, DateTimeOffset.UtcNow);
        PersistEvent(evt, PromptMetadataFor<HumanPromptTerminalReplyAcked>(evt, occurredAt: evt.AcknowledgedAt), Apply);
    }

    private object CreateOperationReply()
    {
        if (_state.Status == HumanPromptStatus.Cancelled)
        {
            var cancelledWorkerAddress = new ActorAddress($"human-prompt/{_promptId.Value}", "local");
            return new OperationCancelled(_key, _correlationId, _adapter, cancelledWorkerAddress);
        }

        if (_state.Status == HumanPromptStatus.Expired)
        {
            return new OperationTimedOut(
                _key,
                _correlationId,
                _adapter,
                new ActorAddress($"human-prompt/{_promptId.Value}", "local"),
                new OperationError(
                    "human_prompt_expired",
                    $"Human prompt '{_promptId.Value}' expired before it was answered.",
                    false));
        }

        if (_state.Status != HumanPromptStatus.Answered || _state.Answer is null)
        {
            return new HumanPromptOperationReplyUnavailable(_promptId, "Prompt does not yet have a terminal answer.");
        }

        var workerAddress = new ActorAddress($"human-prompt/{_promptId.Value}", "local");
        var valueJson = JsonSerializer.Serialize(new
        {
            promptId = _promptId.Value,
            answer = _state.Answer,
            answeredAt = _state.AnsweredAt
        });

        return new OperationResolved(_key, _correlationId, _adapter, workerAddress, new OperationValue(ResourceOperationTypes.HumanAnswer, valueJson));
    }

    private void Apply(HumanPromptRegistered recorded)
    {
        _state = HumanPromptState.Create(recorded.PromptId, recorded.Key, recorded.CorrelationId, recorded.Adapter, recorded.PromptText, recorded.ExpiresAt, recorded.CapabilityId);
        ScheduleExpiryIfNeeded();
    }

    private void Apply(HumanPromptAnswered recorded)
    {
        _state = _state with
        {
            Status = HumanPromptStatus.Answered,
            CancelReason = null,
            CancelledAt = null,
            Answer = recorded.Answer,
            AnsweredAt = recorded.AnsweredAt,
            TerminalReplyPending = true,
            TerminalReplyAcknowledged = false
        };
        Timers.Cancel(ExpiryTimerKey);
    }

    private void Apply(HumanPromptCancelled recorded)
    {
        _state = _state with
        {
            Status = HumanPromptStatus.Cancelled,
            CancelReason = recorded.Reason,
            CancelledAt = recorded.CancelledAt,
            TerminalReplyPending = true,
            TerminalReplyAcknowledged = false
        };
        Timers.Cancel(ExpiryTimerKey);
    }

    private void Apply(HumanPromptExpired _)
    {
        _state = _state with { Status = HumanPromptStatus.Expired, CancelReason = null, CancelledAt = null, TerminalReplyPending = true, TerminalReplyAcknowledged = false };
        Timers.Cancel(ExpiryTimerKey);
    }

    private void Apply(HumanPromptLateAnswerRecorded recorded)
    {
        var lateAnswers = _state.LateAnswers.ToList();
        lateAnswers.Add(new LateHumanAnswer(recorded.Answer, recorded.AnsweredAt));
        _state = _state with { LateAnswers = lateAnswers };
    }

    private void Apply(HumanPromptTerminalReplyAcked _)
    {
        _state = _state with { TerminalReplyPending = false, TerminalReplyAcknowledged = true };
    }

    private EventMetadata PromptMetadataFor<TEvent>(object? payloadForHash = null, DateTimeOffset? occurredAt = null)
        where TEvent : IAvenEvent =>
        MetadataFor<TEvent>(
            new ActorAddress($"human-prompt/{_promptId.Value}", "local"),
            nameof(HumanPromptActor),
            _correlationId,
            payloadForHash,
            operationKey: _key,
            occurredAt: occurredAt);

    private void ScheduleExpiryIfNeeded()
    {
        if (_state.Status != HumanPromptStatus.Open || _state.ExpiresAt is not { } expiresAt)
        {
            Timers.Cancel(ExpiryTimerKey);
            return;
        }

        var delay = expiresAt - DateTimeOffset.UtcNow;
        if (delay < TimeSpan.Zero)
        {
            delay = TimeSpan.Zero;
        }

        Timers.StartSingleTimer(ExpiryTimerKey, new HumanPromptExpiryDue(expiresAt), delay);
    }

    private void TryExpirePrompt(DateTimeOffset deadline, DateTimeOffset observedAt)
    {
        if (_state.Status != HumanPromptStatus.Open)
        {
            Timers.Cancel(ExpiryTimerKey);
            return;
        }

        if (_state.ExpiresAt is not { } expiresAt || observedAt < expiresAt || deadline != expiresAt)
        {
            ScheduleExpiryIfNeeded();
            return;
        }

        var expired = new HumanPromptExpired(_promptId, observedAt);
        PersistEvent(expired, PromptMetadataFor<HumanPromptExpired>(expired, occurredAt: observedAt), e =>
        {
            Apply(e);
            Timers.Cancel(ExpiryTimerKey);
            PublishTerminalReplyIfPossible();
        });
    }

    private void PublishTerminalReplyIfPossible()
    {
        if (!_state.TerminalReplyPending || _state.TerminalReplyAcknowledged)
        {
            return;
        }

        if (_resolver is null)
        {
            return;
        }

        if (!_resolver.TryResolve(_adapter, out var target) || target is null)
        {
            return;
        }

        HumanPromptTerminalReplyReady? reply = _state.Status switch
        {
            HumanPromptStatus.Answered when _state.Answer is not null => new HumanPromptTerminalReplyReady(
                _promptId,
                _key,
                _correlationId,
                HumanPromptStatus.Answered,
                _state.CapabilityId,
                _state.Answer,
                _state.AnsweredAt),
            HumanPromptStatus.Cancelled => new HumanPromptTerminalReplyReady(
                _promptId,
                _key,
                _correlationId,
                HumanPromptStatus.Cancelled,
                _state.CapabilityId,
                CancelReason: _state.CancelReason),
            HumanPromptStatus.Expired => new HumanPromptTerminalReplyReady(
                _promptId,
                _key,
                _correlationId,
                HumanPromptStatus.Expired,
                _state.CapabilityId,
                Error: new OperationError(
                    "human_prompt_expired",
                    $"Human prompt '{_promptId.Value}' expired before it was answered.",
                    false)),
            _ => null
        };

        if (reply is null)
        {
            return;
        }

        target.Tell(reply, Self);
    }
}
