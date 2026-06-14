using Akka.Actor;
using Akka.Persistence;
using Aven.ActorKernel;
using Aven.Toolkit.Core.Serialization;

namespace Aven.DurableDelivery.Actors;

public sealed class DurableDeliveryActor : AvenPersistentActor, IWithTimers
{
    private static readonly CanonicalJsonSerializer CanonicalJsonSerializer = new();
    private readonly IActorAddressResolver _resolver;
    private readonly TimeSpan _retryDelay;
    private readonly int _maxAttempts;
    private readonly DeliveryId _deliveryId;
    private readonly ActorAddress _owner;
    private readonly AvenEnvelope<string> _envelope;
    private readonly PersistedCommandPayload _initialPayload;
    private DeliveryState _state;
    private DateTimeOffset? _expiresAt;
    private readonly ActorAddress? _terminalNotifyTo;
    private const string RetryTimerKey = "delivery-retry";
    private const string ExpiryTimerKey = "delivery-expiry";

    public DurableDeliveryActor(
        string persistenceId,
        DeliveryId deliveryId,
        ActorAddress owner,
        AvenEnvelope<string> envelope,
        string payloadHash,
        IActorAddressResolver resolver,
        TimeSpan? retryDelay = null,
        int maxAttempts = 10,
        DateTimeOffset? expiresAt = null,
        ActorAddress? terminalNotifyTo = null)
    {
        PersistenceId = persistenceId;
        _resolver = resolver;
        _retryDelay = retryDelay ?? TimeSpan.FromMilliseconds(200);
        _maxAttempts = Math.Max(1, maxAttempts);
        _deliveryId = deliveryId;
        _owner = owner;
        _envelope = envelope;
        _expiresAt = expiresAt;
        _terminalNotifyTo = terminalNotifyTo;
        _initialPayload = PersistedCommandPayload.FromInlineJson(envelope.Payload);
        if (!StringComparer.Ordinal.Equals(_initialPayload.Hash, payloadHash))
        {
            throw new InvalidOperationException("Delivery payload hash does not match the bounded persisted command payload.");
        }
        _state = new DeliveryState(
            deliveryId,
            owner,
            CanonicalJsonSerializer.Serialize(envelope),
            envelope.Recipient,
            envelope.CommandId,
            _initialPayload.Hash,
            DeliveryStatus.Created,
            0,
            null,
            null,
            null);

        Command<DeliveryStart>(HandleStart);
        Command<DeliveryAttemptDue>(HandleAttemptDue);
        Command<DeliveryAccepted>(HandleAccepted);
        Command<DeliveryRejected>(HandleRejected);
        Command<DeliveryCancel>(HandleCancel);
        Command<DurableDeliveryRetryTimer>(_ => Self.Tell(new DeliveryAttemptDue(_deliveryId)));
        Command<DurableDeliveryExpiryTimer>(_ => TryExpire(DateTimeOffset.UtcNow));
        Command<DeliveryInspect>(_ => Sender.Tell(_state));
        Command<InitializeDurableDelivery>(_ =>
        {
            if (LastSequenceNr == 0)
            {
                var initialized = new DeliveryInitialized(
                    _deliveryId,
                    _owner,
                    _envelope.CommandId,
                    _envelope.MessageId,
                    _envelope.Sender,
                    _envelope.Recipient,
                    _envelope.ReplyTo,
                    _envelope.CorrelationId,
                    _envelope.MessageType,
                    _envelope.MessageVersion,
                    _initialPayload,
                    _envelope.CapabilityId,
                    _envelope.CausationId,
                    _envelope.CreatedAt,
                    _expiresAt);
                PersistEvent(initialized, MetadataFor<DeliveryInitialized>(
                    new ActorAddress($"delivery/{_deliveryId.Value}", "local"),
                    nameof(DurableDeliveryActor),
                    _envelope.CorrelationId,
                    initialized,
                    commandId: _envelope.CommandId,
                    deliveryId: _deliveryId,
                    causationId: _envelope.CausationId,
                    occurredAt: _envelope.CreatedAt), e =>
                {
                    Apply(e);
                    ScheduleExpiryIfNeeded();
                });
            }
        });

        RecoverEvent<DeliveryInitialized>(Apply);
        RecoverEvent<DeliveryAttemptStarted>(Apply);
        RecoverEvent<DeliveryAcceptedByRecipient>(Apply);
        RecoverEvent<DeliveryRejectedByRecipient>(Apply);
        RecoverEvent<DeliveryExpired>(Apply);
        RecoverEvent<DeliveryCancelled>(Apply);
        RecoverEvent<DeliveryQuarantined>(Apply);
        Recover<RecoveryCompleted>(_ =>
        {
            if (LastSequenceNr == 0)
            {
                Self.Tell(new InitializeDurableDelivery());
                return;
            }

            if (!_state.IsTerminal)
            {
                ScheduleExpiryIfNeeded();

                if (_expiresAt is { } expiresAt && DateTimeOffset.UtcNow >= expiresAt)
                {
                    Self.Tell(new DurableDeliveryExpiryTimer());
                    return;
                }

                if (_state.Attempts > 0)
                {
                    ScheduleRetry(_state.NextAttemptAt ?? DateTimeOffset.UtcNow);
                }
            }
        });
    }

    public override string PersistenceId { get; }
    public ITimerScheduler Timers { get; set; } = null!;

    private void HandleStart(DeliveryStart start)
    {
        if (start.DeliveryId != _deliveryId || _state.IsTerminal)
        {
            return;
        }

        if (TryExpire(DateTimeOffset.UtcNow))
        {
            return;
        }

        AttemptDelivery();
    }

    private void HandleAttemptDue(DeliveryAttemptDue due)
    {
        if (due.DeliveryId != _deliveryId || _state.IsTerminal)
        {
            return;
        }

        if (TryExpire(DateTimeOffset.UtcNow))
        {
            return;
        }

        AttemptDelivery();
    }

    private void AttemptDelivery()
    {
        var attemptNumber = _state.Attempts + 1;
        var attemptedAt = DateTimeOffset.UtcNow;

        if (attemptNumber > _maxAttempts)
        {
            var evt = new DeliveryQuarantined(
                _deliveryId,
                new OperationError(
                    "delivery_retry_exhausted",
                    $"Delivery exceeded the retry budget of {_maxAttempts} attempts.",
                    false));
            PersistEvent(evt, DeliveryMetadataFor<DeliveryQuarantined>(evt.Error), e =>
            {
                Apply(e);
                Timers.Cancel(RetryTimerKey);
                Timers.Cancel(ExpiryTimerKey);
                NotifyTerminalTarget();
            });
            return;
        }

        if (!_resolver.TryResolve(_state.Recipient, out var recipient) || recipient is null)
        {
            var nextAttemptAt = attemptedAt.Add(_retryDelay);
            var evt = new DeliveryAttemptStarted(_deliveryId, attemptNumber, attemptedAt, nextAttemptAt, DeliveryAttemptResult.RecipientUnresolved);
            PersistEvent(evt, DeliveryMetadataFor<DeliveryAttemptStarted>(new
            {
                evt.DeliveryId,
                evt.AttemptNumber,
                evt.AttemptedAt,
                evt.NextAttemptAt,
                evt.Result,
                PayloadHash = _state.PayloadHash
            }), e =>
            {
                Apply(e);
                ScheduleRetry(nextAttemptAt);
                ScheduleExpiryIfNeeded();
            });
            return;
        }

        var nextResolvedAttemptAt = attemptedAt.Add(_retryDelay);
        var started = new DeliveryAttemptStarted(_deliveryId, attemptNumber, attemptedAt, nextResolvedAttemptAt, DeliveryAttemptResult.TellPlanned);
        PersistEvent(started, DeliveryMetadataFor<DeliveryAttemptStarted>(new
        {
            started.DeliveryId,
            started.AttemptNumber,
            started.AttemptedAt,
            started.NextAttemptAt,
            started.Result,
            PayloadHash = _state.PayloadHash
        }), e =>
        {
            Apply(e);
            recipient.Tell(new DeliveryAttemptOffer(_deliveryId, DeserializeEnvelope(_state.EnvelopeJson), _state.PayloadHash), Self);
            ScheduleRetry(e.NextAttemptAt ?? nextResolvedAttemptAt);
            ScheduleExpiryIfNeeded();
        });
    }

    private void HandleAccepted(DeliveryAccepted accepted)
    {
        if (accepted.DeliveryId != _deliveryId || _state.IsTerminal)
        {
            return;
        }

        if (TryExpire(DateTimeOffset.UtcNow))
        {
            return;
        }

        var acceptedAt = DateTimeOffset.UtcNow;
        var evt = new DeliveryAcceptedByRecipient(_deliveryId, acceptedAt, accepted.AcceptanceKind);
        PersistEvent(evt, DeliveryMetadataFor<DeliveryAcceptedByRecipient>(evt, occurredAt: acceptedAt), e =>
        {
            Apply(e);
            Timers.Cancel(RetryTimerKey);
            Timers.Cancel(ExpiryTimerKey);
            NotifyTerminalTarget();
        });
    }

    private void HandleRejected(DeliveryRejected rejected)
    {
        if (rejected.DeliveryId != _deliveryId || _state.IsTerminal)
        {
            return;
        }

        if (TryExpire(DateTimeOffset.UtcNow))
        {
            return;
        }

        if (rejected.Error.Retryable)
        {
            ScheduleRetry(_state.NextAttemptAt ?? DateTimeOffset.UtcNow.Add(_retryDelay));
            ScheduleExpiryIfNeeded();
            return;
        }

        var evt = new DeliveryRejectedByRecipient(_deliveryId, rejected.Error);
        PersistEvent(evt, DeliveryMetadataFor<DeliveryRejectedByRecipient>(evt), e =>
        {
            Apply(e);
            Timers.Cancel(RetryTimerKey);
            Timers.Cancel(ExpiryTimerKey);
            NotifyTerminalTarget();
        });
    }

    private void HandleCancel(DeliveryCancel cancel)
    {
        if (cancel.DeliveryId != _deliveryId || _state.IsTerminal)
        {
            return;
        }

        var evt = new DeliveryCancelled(_deliveryId, cancel.Reason);
        PersistEvent(evt, DeliveryMetadataFor<DeliveryCancelled>(evt), e =>
        {
            Apply(e);
            Timers.Cancel(RetryTimerKey);
            Timers.Cancel(ExpiryTimerKey);
            NotifyTerminalTarget();
        });
    }

    private void Apply(DeliveryInitialized e)
    {
        _expiresAt = e.ExpiresAt;
        var envelope = new AvenEnvelope<string>(
            e.CommandId,
            e.MessageId,
            e.Sender,
            e.Recipient,
            e.ReplyTo,
            e.CorrelationId,
            e.MessageType,
            e.MessageVersion,
            e.Payload.Json,
            e.CapabilityId,
            e.CausationId,
            e.CreatedAt);
        _state = new DeliveryState(
            e.DeliveryId,
            e.Owner,
            CanonicalJsonSerializer.Serialize(envelope),
            e.Recipient,
            e.CommandId,
            e.Payload.Hash,
            DeliveryStatus.Created,
            0,
            null,
            null,
            null);
    }

    private void Apply(DeliveryAttemptStarted e)
    {
        _state = _state with
        {
            Status = DeliveryStatus.Sending,
            Attempts = e.AttemptNumber,
            NextAttemptAt = e.NextAttemptAt
        };
    }

    private void Apply(DeliveryAcceptedByRecipient e)
    {
        _state = _state with
        {
            Status = DeliveryStatus.Accepted,
            AcceptedAt = e.AcceptedAt,
            NextAttemptAt = null
        };
    }

    private void Apply(DeliveryRejectedByRecipient e)
    {
        _state = _state with
        {
            Status = DeliveryStatus.Rejected,
            TerminalError = e.Error,
            NextAttemptAt = null
        };
    }

    private void Apply(DeliveryExpired e)
    {
        _state = _state with
        {
            Status = DeliveryStatus.Expired,
            TerminalError = e.Error,
            NextAttemptAt = null,
            AcceptedAt = null
        };
    }

    private void ScheduleExpiryIfNeeded()
    {
        if (_state.IsTerminal || _expiresAt is not { } expiresAt)
        {
            Timers.Cancel(ExpiryTimerKey);
            return;
        }

        var delay = expiresAt - DateTimeOffset.UtcNow;
        if (delay < TimeSpan.Zero)
        {
            delay = TimeSpan.Zero;
        }

        Timers.StartSingleTimer(ExpiryTimerKey, new DurableDeliveryExpiryTimer(), delay);
    }

    private void Apply(DeliveryCancelled e)
    {
        _state = _state with
        {
            Status = DeliveryStatus.Cancelled,
            TerminalError = new OperationError("delivery_cancelled", e.Reason, false),
            NextAttemptAt = null
        };
    }

    private void Apply(DeliveryQuarantined e)
    {
        _state = _state with
        {
            Status = DeliveryStatus.Quarantined,
            TerminalError = e.Error,
            NextAttemptAt = null
        };
    }

    private void NotifyTerminalTarget()
    {
        if (!_state.IsTerminal || _terminalNotifyTo is not { } terminalNotifyTo)
        {
            return;
        }

        if (_resolver.TryResolve(terminalNotifyTo, out var target) && target is not null)
        {
            target.Tell(new DeliveryTerminalSignal(_deliveryId, _state), Self);
        }
    }

    private bool TryExpire(DateTimeOffset now)
    {
        if (_state.IsTerminal || _expiresAt is not { } expiresAt || now < expiresAt)
        {
            return false;
        }

        var error = new OperationError(
            "delivery_expired",
            $"Delivery expired at {expiresAt:O}.",
            false);

        var evt = new DeliveryExpired(_deliveryId, now, error);
        PersistEvent(evt, DeliveryMetadataFor<DeliveryExpired>(evt, occurredAt: now), e =>
        {
            Apply(e);
            Timers.Cancel(RetryTimerKey);
            Timers.Cancel(ExpiryTimerKey);
            NotifyTerminalTarget();
        });

        return true;
    }

    private void ScheduleRetry(DateTimeOffset when)
    {
        var delay = when - DateTimeOffset.UtcNow;
        if (delay < TimeSpan.Zero)
        {
            delay = TimeSpan.Zero;
        }

        Timers.StartSingleTimer(RetryTimerKey, new DurableDeliveryRetryTimer(), delay);
    }

    private static AvenEnvelope<string> DeserializeEnvelope(string json) =>
        System.Text.Json.JsonSerializer.Deserialize<AvenEnvelope<string>>(json, CanonicalJsonSerializer.DefaultOptions)
        ?? throw new InvalidOperationException("Failed to deserialize delivery envelope.");

    private EventMetadata DeliveryMetadataFor<TEvent>(object? payloadForHash = null, DateTimeOffset? occurredAt = null)
        where TEvent : IAvenEvent =>
        MetadataFor<TEvent>(
            new ActorAddress($"delivery/{_deliveryId.Value}", "local"),
            nameof(DurableDeliveryActor),
            _envelope.CorrelationId,
            payloadForHash,
            commandId: _envelope.CommandId,
            deliveryId: _deliveryId,
            causationId: _envelope.CausationId,
            occurredAt: occurredAt);
}
