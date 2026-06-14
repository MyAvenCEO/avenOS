using Akka.Actor;
using Akka.Persistence;
using Aven.ActorKernel;
using Aven.Submission.Contracts.Protocol;
using Aven.Contracts.Protocol.Envelopes;
using Aven.DurableDelivery;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Submission.Actors;

public sealed class MessageSubmissionActor : AvenPersistentActor
{
    private readonly RoleRoutingClient _router;
    private readonly CanonicalJsonSerializer _serializer;
    private readonly IActorAddressResolver _resolver;
    private readonly DurableDeliveryFactory _deliveryLauncher;
    private readonly ActorAddress _ingressAddress = new("submission/http", "local");
    private readonly Dictionary<string, SubmittedMessageRecord> _commands = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SubmittedMessageProjection> _projections = new(StringComparer.Ordinal);
    private readonly Dictionary<DeliveryId, IActorRef> _pendingReplies = new();
    private static readonly ActorAddress RoutingGatewayAddress = new("routing/role", "local");
    private const string RouteResolutionMissingCode = "route_resolution_missing";

    public MessageSubmissionActor(
        string persistenceId,
        RoleRoutingClient router,
        CanonicalJsonSerializer serializer,
        IActorAddressResolver resolver)
    {
        PersistenceId = persistenceId;
        _router = router;
        _serializer = serializer;
        _resolver = resolver;
        _deliveryLauncher = new DurableDeliveryFactory(resolver);

        Command<SubmitMessageCommand>(command => HandleSubmit(command.Command));
        Command<DeliveryTerminalSignal>(HandleTerminalNotification);
        Command<InspectSubmissionsCommand>(_ => Sender.Tell(new SubmissionInspection(new Dictionary<string, SubmittedMessageRecord>(_commands))));

        RecoverEvent<MessageSubmitted>(Apply);
        RecoverEvent<RoutingDeliveryAccepted>(Apply);
        RecoverEvent<RoutingDeliveryRejected>(Apply);
        RecoverEvent<RouteResolutionRecorded>(Apply);
        RecoverEvent<SubmissionRejected>(Apply);
        RecoverEvent<SubmissionConflictRecorded>(Apply);
        Recover<RecoveryCompleted>(_ =>
        {
            if (_resolver is IActorAddressRegistry registry)
            {
                registry.Register(_ingressAddress, Self);
            }

            RebuildCommandsFromProjections();
            ResumePendingOperations();
        });
    }

    public override string PersistenceId { get; }

    private void HandleSubmit(SubmitMessageRequest command)
    {
        if (string.IsNullOrWhiteSpace(command.IdempotencyKey))
        {
            Sender.Tell(new SubmitMessageRejected(command.IdempotencyKey, new OperationError("missing_idempotency_key", "HTTP submission commands require an idempotency key.", false)));
            return;
        }

        var bodyHash = _serializer.Hash(new
        {
            command.IncomingItemRef,
            command.InputType,
            command.AttachmentRefs,
            command.ContentSummary,
            command.ProposedIntent,
            command.ProposedReason,
            RequiredSchemas = command.RequiredSchemas.Select(static x => x.Value).ToArray()
        });
        var routingAttemptId = new RoutingAttemptId($"route-{command.IdempotencyKey}");
        var correlationId = new CorrelationId($"corr-{command.IdempotencyKey}");

        if (TryGetRecoveredRecord(command.IdempotencyKey, out var existing))
        {
            if (!StringComparer.Ordinal.Equals(existing.BodyHash, bodyHash))
            {
                var error = new OperationError("idempotency_conflict", "The same idempotency key was used with a different request body.", false);
                var conflictedAt = DateTimeOffset.UtcNow;
                PersistFact(
                    new SubmissionConflictRecorded(command.IdempotencyKey, existing.BodyHash, bodyHash, error, conflictedAt),
                    new CorrelationId($"corr-{command.IdempotencyKey}"),
                    conflictedAt,
                    () => Sender.Tell(new SubmitMessageConflict(command.IdempotencyKey, error)));
                return;
            }

            if (existing.Status == SubmittedMessageStatus.Accepted && existing.RoutingAttemptId is { } existingRoutingAttemptId && existing.Decision is not null)
            {
                Sender.Tell(CreateAcceptedResponse(command.IdempotencyKey, true, new CorrelationId($"corr-{command.IdempotencyKey}"), existingRoutingAttemptId, existing.Delivery, existing.Decision));
                return;
            }

            if (existing.Error is not null)
            {
                Sender.Tell(existing.Status switch
                {
                    SubmittedMessageStatus.Conflict => new SubmitMessageConflict(command.IdempotencyKey, existing.Error),
                    SubmittedMessageStatus.Rejected => new SubmitMessageRejected(command.IdempotencyKey, existing.Error),
                    _ => new SubmitMessageRejected(command.IdempotencyKey, existing.Error)
                });
                return;
            }
        }

        if (TryRecoverRecordFromRouting(command, bodyHash, routingAttemptId, correlationId, out var recoveredRecord))
        {
            _commands[command.IdempotencyKey] = recoveredRecord;
            if (recoveredRecord.Error is not null)
            {
                Sender.Tell(new SubmitMessageRejected(command.IdempotencyKey, recoveredRecord.Error));
                return;
            }

            Sender.Tell(CreateAcceptedResponse(command.IdempotencyKey, true, correlationId, routingAttemptId, recoveredRecord.Delivery, recoveredRecord.Decision!));
            return;
        }

        var routeInput = new RouteInput(
            routingAttemptId,
            command.IncomingItemRef,
            command.InputType,
            command.AttachmentRefs,
            command.ContentSummary,
            command.ProposedIntent,
            command.ProposedReason,
            command.RequiredSchemas,
            correlationId,
            new ActorAddress("submission/http", "local"));

        var deliveryId = new DeliveryId($"delivery-{command.IdempotencyKey}");
        var commandId = new CommandId($"cmd-{command.IdempotencyKey}");
        var messageId = new MessageId($"msg-{command.IdempotencyKey}");
        var recordedAt = DateTimeOffset.UtcNow;
        var envelope = CreateEnvelope(routeInput, commandId, messageId, correlationId, recordedAt);
        var received = new MessageSubmitted(
            command.IdempotencyKey,
            bodyHash,
            command.IncomingItemRef,
            command.InputType,
            command.AttachmentRefs.ToArray(),
            command.ContentSummary,
            command.ProposedIntent,
            command.ProposedReason,
            command.RequiredSchemas.ToArray(),
            routingAttemptId,
            deliveryId,
            commandId,
            messageId,
            recordedAt);

        var replyTo = Sender;
        PersistFact(received, correlationId, recordedAt, () =>
        {
            if (!replyTo.IsNobody())
            {
                _pendingReplies[deliveryId] = replyTo;
            }

            _deliveryLauncher.StartOrResume(
                Context,
                PersistenceId,
                DurableDeliveryStartFactory.ForEnvelope(envelope)
                    .OwnedBy(_ingressAddress)
                    .WithDeliveryId(deliveryId)
                    .WithPolicy(new DeliveryPolicy(TimeSpan.FromMilliseconds(250), 120))
                    .NotifyTerminal(_ingressAddress)
                    .Build());
        });
    }

    private void HandleTerminalNotification(DeliveryTerminalSignal notification)
    {
        if (!TryGetProjectionByDeliveryId(notification.DeliveryId, out var projection)
            || projection.Received is not { } received)
        {
            return;
        }

        var replyTo = _pendingReplies.TryGetValue(notification.DeliveryId, out var pendingReply)
            ? pendingReply
            : ActorRefs.NoSender;
        _pendingReplies.Remove(notification.DeliveryId);

        var correlationId = new CorrelationId($"corr-{received.IdempotencyKey}");
        if (notification.State.Status != DeliveryStatus.Accepted)
        {
            var error = notification.State.TerminalError
                ?? new OperationError("delivery_not_accepted", $"Submission delivery ended with status {notification.State.Status}.", false);
            PersistFactsTail(
                new IAvenEvent[]
                {
                    new SubmissionRejected(received.IdempotencyKey, received.BodyHash, received.RoutingAttemptId, error, DateTimeOffset.UtcNow),
                    new RoutingDeliveryRejected(received.IdempotencyKey, received.RoutingAttemptId, received.DeliveryId, error)
                },
                0,
                correlationId,
                () =>
                {
                    if (!replyTo.IsNobody())
                    {
                        replyTo.Tell(new SubmitMessageRejected(received.IdempotencyKey, error));
                    }
                });
            return;
        }

        var routeInput = CreateRouteInput(received);
        RouteResolution decision;
        try
        {
            decision = ResolveRouteResolution(routeInput.RoutingAttemptId);
        }
        catch (InvalidOperationException ex) when (IsMissingRouteResolution(ex))
        {
            var error = new OperationError(RouteResolutionMissingCode, ex.Message, true);
            PersistFactsTail(
                new IAvenEvent[]
                {
                    new SubmissionRejected(received.IdempotencyKey, received.BodyHash, received.RoutingAttemptId, error, DateTimeOffset.UtcNow),
                    new RoutingDeliveryRejected(received.IdempotencyKey, received.RoutingAttemptId, received.DeliveryId, error)
                },
                0,
                correlationId,
                () =>
                {
                    if (!replyTo.IsNobody())
                    {
                        replyTo.Tell(new SubmitMessageRejected(received.IdempotencyKey, error));
                    }
                });
            return;
        }

        switch (decision)
        {
            case RouteCommitted committed:
                var delivery = notification.State;
                PersistFactsTail(
                    new IAvenEvent[]
                    {
                        new RoutingDeliveryAccepted(received.IdempotencyKey, received.RoutingAttemptId, received.DeliveryId, delivery.AcceptedAt ?? DateTimeOffset.UtcNow, "recipient_accepted"),
                        ToDecisionRecorded(received.IdempotencyKey, received.RoutingAttemptId, committed)
                    },
                    0,
                    correlationId,
                    () =>
                    {
                        if (!replyTo.IsNobody())
                        {
                            replyTo.Tell(CreateAcceptedResponse(received.IdempotencyKey, false, correlationId, received.RoutingAttemptId, delivery, committed));
                        }
                    });
                return;
            case RouteNeedsClarification clarification:
                PersistFactsTail(
                    [ToDecisionRecorded(received.IdempotencyKey, received.RoutingAttemptId, clarification)],
                    0,
                    correlationId,
                    () =>
                    {
                        if (!replyTo.IsNobody())
                        {
                            replyTo.Tell(new SubmitMessageNeedsClarification(received.IdempotencyKey, false, correlationId, received.RoutingAttemptId, clarification));
                        }
                    });
                return;
            case RouteRejected rejected:
                var rejectedError = ToSubmissionRejectionError(rejected);
                PersistFactsTail(
                    new IAvenEvent[]
                    {
                        new SubmissionRejected(received.IdempotencyKey, received.BodyHash, received.RoutingAttemptId, rejectedError, DateTimeOffset.UtcNow),
                        ToDecisionRecorded(received.IdempotencyKey, received.RoutingAttemptId, rejected)
                    },
                    0,
                    correlationId,
                    () =>
                    {
                        if (!replyTo.IsNobody())
                        {
                            replyTo.Tell(new SubmitMessageRejected(received.IdempotencyKey, rejectedError));
                        }
                    });
                return;
            default:
                throw new InvalidOperationException($"Unsupported routing decision type '{decision.GetType().Name}'.");
        }
    }

    private RouteResolution ResolveRouteResolution(RoutingAttemptId routingAttemptId)
    {
        var resolution = _router.GetResolution(routingAttemptId);
        if (resolution is null)
        {
            throw new InvalidOperationException($"Routing attempt '{routingAttemptId.Value}' did not expose a terminal route resolution before submission delivery acceptance.");
        }

        return resolution;
    }

    private static RouteResolution ResolveClarificationOrRejection(RouteAttemptRecord attempt)
    {
        if (attempt.ClarificationCandidateRoleAgentIds.Count > 0)
        {
            return new RouteNeedsClarification(
                attempt,
                attempt.ClarificationQuestion ?? "Clarification required.",
                attempt.ClarificationCandidateRoleAgentIds);
        }

        var acceptedCandidates = attempt.AuditEntries
            .Where(static x => x.DecisionKind == "accepted")
            .Select(static x => x.RoleAgentId)
            .Distinct()
            .ToArray();
        if (acceptedCandidates.Length > 0)
        {
            return new RouteNeedsClarification(
                attempt,
                attempt.ClarificationQuestion ?? "Clarification required.",
                acceptedCandidates);
        }

        var clarificationCandidates = attempt.AuditEntries
            .Where(static x => x.DecisionKind == "needs_clarification")
            .Select(static x => x.RoleAgentId)
            .Distinct()
            .ToArray();
        if (clarificationCandidates.Length > 0 || attempt.AuditEntries.Count == 0)
        {
            return new RouteNeedsClarification(
                attempt,
                attempt.ClarificationQuestion ?? "Clarification required.",
                clarificationCandidates);
        }

        return new RouteRejected(attempt, attempt.ClarificationQuestion ?? "Routing rejected.");
    }

    private static OperationError ToSubmissionRejectionError(RouteRejected rejected)
    {
        var code = rejected.Attempt.Status == RouteAttemptStatus.ClarificationRequired
            ? "no_candidate_accepted"
            : "route_rejected";
        return new OperationError(code, rejected.Reason, false);
    }

    private static object CreateAcceptedResponse(
        string idempotencyKey,
        bool idempotent,
        CorrelationId correlationId,
        RoutingAttemptId routingAttemptId,
        DeliveryState? delivery,
        RouteResolution decision) =>
        decision switch
        {
            RouteNeedsClarification clarification => new SubmitMessageNeedsClarification(
                idempotencyKey,
                idempotent,
                correlationId,
                routingAttemptId,
                clarification),
            _ when delivery is not null => new SubmitMessageAccepted(
                idempotencyKey,
                idempotent,
                correlationId,
                routingAttemptId,
                delivery,
                decision),
            _ => throw new InvalidOperationException($"Accepted submission '{idempotencyKey}' is missing a delivery for decision type '{decision.GetType().Name}'.")
        };

    private RouteResolutionRecorded ToDecisionRecorded(string idempotencyKey, RoutingAttemptId routingAttemptId, RouteResolution decision) => decision switch
    {
        RouteCommitted committed => new RouteResolutionRecorded(
            idempotencyKey,
            routingAttemptId,
            nameof(RouteCommitted),
            committed.RoleAgentId,
            committed.ClaimId,
            null,
            Array.Empty<Aven.Toolkit.Core.Identifiers.RoleAgentId>(),
            null),
        RouteNeedsClarification clarification => new RouteResolutionRecorded(
            idempotencyKey,
            routingAttemptId,
            nameof(RouteNeedsClarification),
            null,
            null,
            clarification.Question,
            clarification.CandidateRoleAgentIds.ToArray(),
            null),
        RouteRejected rejected => new RouteResolutionRecorded(
            idempotencyKey,
            routingAttemptId,
            nameof(RouteRejected),
            null,
            null,
            null,
            Array.Empty<Aven.Toolkit.Core.Identifiers.RoleAgentId>(),
            rejected.Reason),
        _ => throw new InvalidOperationException($"Unsupported routing decision type '{decision.GetType().Name}'.")
    };

    private void PersistFactsTail(IReadOnlyList<IAvenEvent> events, int index, CorrelationId correlationId, Action afterPersist)
    {
        if (index >= events.Count)
        {
            afterPersist();
            return;
        }

        PersistFactDynamic(events[index], correlationId, DateTimeOffset.UtcNow, () => PersistFactsTail(events, index + 1, correlationId, afterPersist));
    }

    private void PersistFactDynamic(IAvenEvent evt, CorrelationId correlationId, DateTimeOffset occurredAt, Action afterPersist)
    {
        switch (evt)
        {
            case MessageSubmitted received:
                PersistFact(received, correlationId, occurredAt, afterPersist);
                break;
            case RoutingDeliveryAccepted accepted:
                PersistFact(accepted, correlationId, occurredAt, afterPersist);
                break;
            case RoutingDeliveryRejected rejected:
                PersistFact(rejected, correlationId, occurredAt, afterPersist);
                break;
            case RouteResolutionRecorded recorded:
                PersistFact(recorded, correlationId, occurredAt, afterPersist);
                break;
            case SubmissionRejected rejected:
                PersistFact(rejected, correlationId, occurredAt, afterPersist);
                break;
            case SubmissionConflictRecorded conflict:
                PersistFact(conflict, correlationId, occurredAt, afterPersist);
                break;
            default:
                throw new InvalidOperationException($"Unsupported submission event type '{evt.GetType().Name}'.");
        }
    }

    private void PersistFact<TEvent>(TEvent evt, CorrelationId correlationId, DateTimeOffset occurredAt, Action afterPersist)
        where TEvent : IAvenEvent
    {
        PersistEvent(evt, MetadataFor<TEvent>(
            new ActorAddress("submission/http", "local"),
            nameof(MessageSubmissionActor),
            correlationId,
            evt,
            commandId: evt switch
            {
                MessageSubmitted received => received.CommandId,
                _ => null
            },
            deliveryId: evt switch
            {
                MessageSubmitted received => received.DeliveryId,
                RoutingDeliveryAccepted accepted => accepted.DeliveryId,
                RoutingDeliveryRejected rejected => rejected.DeliveryId,
                _ => null
            },
            occurredAt: occurredAt), _ =>
        {
            Apply(evt);
            afterPersist();
        });
    }

    private SubmittedMessageProjection GetProjection(string idempotencyKey)
    {
        if (!_projections.TryGetValue(idempotencyKey, out var projection))
        {
            projection = new SubmittedMessageProjection();
            _projections[idempotencyKey] = projection;
        }

        return projection;
    }

    private bool TryGetRecoveredRecord(string idempotencyKey, out SubmittedMessageRecord record)
    {
        if (_commands.TryGetValue(idempotencyKey, out record!))
        {
            if (record.Status != SubmittedMessageStatus.Accepted || record.Decision is not null)
            {
                return true;
            }
        }

        if (_projections.TryGetValue(idempotencyKey, out var projection))
        {
            record = projection.ToRecord();
            _commands[idempotencyKey] = record;
            return true;
        }

        record = null!;
        return false;
    }

    private bool TryRecoverRecordFromRouting(
        SubmitMessageRequest command,
        string bodyHash,
        RoutingAttemptId routingAttemptId,
        CorrelationId correlationId,
        out SubmittedMessageRecord record)
    {
        var decision = _router.GetResolution(routingAttemptId);
        if (decision is null)
        {
            record = null!;
            return false;
        }

        record = decision switch
        {
            RouteCommitted => new SubmittedMessageRecord(
                command.IdempotencyKey,
                bodyHash,
                SubmittedMessageStatus.Accepted,
                DateTimeOffset.UtcNow,
                routingAttemptId,
                new DeliveryState(
                    new DeliveryId($"delivery-{command.IdempotencyKey}"),
                    new ActorAddress("submission/http", "local"),
                    string.Empty,
                    RoutingGatewayAddress,
                    new CommandId($"cmd-{command.IdempotencyKey}"),
                    bodyHash,
                    DeliveryStatus.Accepted,
                    1,
                    null,
                    DateTimeOffset.UtcNow,
                    null),
                decision,
                null),
            RouteNeedsClarification => new SubmittedMessageRecord(
                command.IdempotencyKey,
                bodyHash,
                SubmittedMessageStatus.Accepted,
                DateTimeOffset.UtcNow,
                routingAttemptId,
                null,
                decision,
                null),
            RouteRejected rejected => new SubmittedMessageRecord(
                command.IdempotencyKey,
                bodyHash,
                SubmittedMessageStatus.Rejected,
                DateTimeOffset.UtcNow,
                routingAttemptId,
                null,
                rejected,
                ToSubmissionRejectionError(rejected)),
            _ => throw new InvalidOperationException($"Unsupported recovered routing decision type '{decision.GetType().Name}'.")
        };
        return true;
    }

    private void RebuildCommandsFromProjections()
    {
        foreach (var (idempotencyKey, projection) in _projections)
        {
            _commands[idempotencyKey] = projection.ToRecord();
        }
    }

    private void ResumePendingOperations()
    {
        foreach (var projection in _projections.Values)
        {
            if (projection.Received is not { } received
                || projection.DeliveryAccepted is not null
                || projection.DeliveryRejected is not null)
            {
                continue;
            }

            var routeInput = CreateRouteInput(received);
            var envelope = CreateEnvelope(routeInput, new CommandId($"cmd-{received.IdempotencyKey}"), new MessageId($"msg-{received.IdempotencyKey}"), new CorrelationId($"corr-{received.IdempotencyKey}"), received.RecordedAt);
            _deliveryLauncher.StartOrResume(
                Context,
                PersistenceId,
                DurableDeliveryStartFactory.ForEnvelope(envelope)
                    .OwnedBy(_ingressAddress)
                    .WithDeliveryId(received.DeliveryId)
                    .WithPolicy(new DeliveryPolicy(TimeSpan.FromMilliseconds(100), 20))
                    .NotifyTerminal(_ingressAddress)
                    .Build());
        }
    }

    private static RouteInput CreateRouteInput(MessageSubmitted received) =>
        new(
            received.RoutingAttemptId,
            received.IncomingItemRef,
            received.InputType,
            received.AttachmentRefs,
            received.ContentSummary,
            received.ProposedIntent,
            received.ProposedReason,
            received.RequiredSchemaRefs,
            new CorrelationId($"corr-{received.IdempotencyKey}"),
            new ActorAddress("submission/http", "local"));

    private static bool IsMissingRouteResolution(InvalidOperationException ex)
        => ex.Message.Contains("did not expose a terminal route resolution before submission delivery acceptance", StringComparison.Ordinal);

    private static AvenEnvelope<string> CreateEnvelope(RouteInput routeInput, CommandId commandId, MessageId messageId, CorrelationId correlationId, DateTimeOffset createdAt) =>
        AvenEnvelopeBuilder
            .ForMessage(SubmissionMessageTypes.RouteInput, System.Text.Json.JsonSerializer.Serialize(routeInput, CanonicalJsonSerializer.DefaultOptions))
            .From(new ActorAddress("api/messages", "http"))
            .To(RoutingGatewayAddress)
            .ReplyTo(new ActorAddress("submission/http", "local"))
            .WithCorrelation(correlationId)
            .WithCommandId(commandId)
            .WithMessageId(messageId)
            .WithCreatedAt(createdAt)
            .Build();

    private bool TryGetProjectionByDeliveryId(DeliveryId deliveryId, out SubmittedMessageProjection projection)
    {
        projection = _projections.Values.FirstOrDefault(x => x.Received?.DeliveryId == deliveryId)!;
        return projection is not null;
    }

    private void Apply(MessageSubmitted received)
    {
        var projection = GetProjection(received.IdempotencyKey);
        projection.Apply(received);
        _commands[received.IdempotencyKey] = projection.ToRecord();
    }

    private void Apply(RoutingDeliveryAccepted accepted)
    {
        var projection = GetProjection(accepted.IdempotencyKey);
        projection.Apply(accepted);
        _commands[accepted.IdempotencyKey] = projection.ToRecord();
    }

    private void Apply(RoutingDeliveryRejected rejected)
    {
        var projection = GetProjection(rejected.IdempotencyKey);
        projection.Apply(rejected);
        _commands[rejected.IdempotencyKey] = projection.ToRecord();
    }

    private void Apply(RouteResolutionRecorded recorded)
    {
        var projection = GetProjection(recorded.IdempotencyKey);
        projection.Apply(recorded);
        _commands[recorded.IdempotencyKey] = projection.ToRecord();
    }

    private void Apply(SubmissionRejected rejected)
    {
        var projection = GetProjection(rejected.IdempotencyKey);
        projection.Apply(rejected);
        _commands[rejected.IdempotencyKey] = projection.ToRecord();
    }

    private void Apply(SubmissionConflictRecorded conflict)
    {
        var projection = GetProjection(conflict.IdempotencyKey);
        projection.Apply(conflict);
        _commands[conflict.IdempotencyKey] = projection.ToRecord();
    }

    private void Apply<TEvent>(TEvent evt)
        where TEvent : IAvenEvent
    {
        switch (evt)
        {
            case MessageSubmitted received:
                Apply(received);
                break;
            case RoutingDeliveryAccepted accepted:
                Apply(accepted);
                break;
            case RoutingDeliveryRejected rejected:
                Apply(rejected);
                break;
            case RouteResolutionRecorded recorded:
                Apply(recorded);
                break;
            case SubmissionRejected rejected:
                Apply(rejected);
                break;
            case SubmissionConflictRecorded conflict:
                Apply(conflict);
                break;
            default:
                throw new InvalidOperationException($"Unsupported submission event type '{typeof(TEvent).Name}'.");
        }
    }
}
