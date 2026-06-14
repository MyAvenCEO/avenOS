using System.Text.Json;
using Akka.Actor;
using Aven.ActorKernel;
using Aven.DurableDelivery.Contracts.Responses;
using Aven.Routing.Runtime.Delivery;
using Aven.Routing.Runtime.Events;
using Aven.Routing.Runtime.Planning;
using Aven.Routing.Runtime.Resolution;
using Aven.Routing.Runtime.State;
using Aven.Toolkit.Core.Serialization;
using Aven.WorkIntake.Contracts.Support;

namespace Aven.Routing.Actors;

public sealed class RoleRouterActor : AvenPersistentActor
{
    private sealed record PendingRouteReply(IActorRef ReplyTo, DeliveryAttemptOffer? Offer, string? SuccessAcceptanceKind);
    private sealed record RouteEvaluationCompleted(RouteInput Input, IActorRef ReplyTo, RouteResolution Resolution);
    private sealed record RouteEvaluationFailed(RouteInput Input, IActorRef ReplyTo, Exception Exception);

    private readonly Aven.RoleAgents.Registry.Clients.IRoleAgentRegistryClient _roleAgentRegistry;
    private readonly Func<RoleAgentId, WorkIntakeClient> _intakeFactory;
    private readonly LlmRoleSelector? _llmRouting;
    private readonly Dictionary<RoutingAttemptId, RouteAttemptRecord> _attempts = new();
    private readonly Dictionary<RoutingAttemptId, RoutingAttemptProjection> _projections = new();
    private readonly Dictionary<RoutingAttemptId, List<PendingRouteReply>> _pendingRouteReplies = new();

    public RoleRouterActor(
        string persistenceId,
        Aven.RoleAgents.Registry.Clients.IRoleAgentRegistryClient roleAgentRegistry,
        Func<RoleAgentId, WorkIntakeClient> intakeFactory,
        LlmRoleSelector? llmRouting = null)
    {
        PersistenceId = persistenceId;
        _roleAgentRegistry = roleAgentRegistry;
        _intakeFactory = intakeFactory;
        _llmRouting = llmRouting;

        Command<RouteCommand>(command => HandleRoute(command.Input));
        Command<DeliveryAttemptOffer>(HandleDeliveryAttemptOffer);
        Command<RouteEvaluationCompleted>(HandleRouteEvaluationCompleted);
        Command<RouteEvaluationFailed>(HandleRouteEvaluationFailed);
        Command<RecordRouteAttemptCommand>(HandleRecordRouteAttempt);
        Command<GetRouteAttemptCommand>(HandleGetRouteAttempt);
        Command<GetRouteResolutionCommand>(HandleGetRouteResolution);
        Command<InspectRouteAttempts>(HandleInspectRouteAttempts);

        RecoverEvent<RouteAttemptStarted>(Apply);
        RecoverEvent<RoleSelectorEvaluationRecorded>(Apply);
        RecoverEvent<RouteCandidateEvaluated>(Apply);
        RecoverEvent<RoutingCommitted>(Apply);
        RecoverEvent<RoutingClarificationRequested>(Apply);
        RecoverEvent<RoutingRejected>(Apply);
    }

    public override string PersistenceId { get; }

    private void HandleRoute(RouteInput input)
    {
        if (_attempts.TryGetValue(input.RoutingAttemptId, out var existing))
        {
            Sender.Tell(RouteResolutionFactory.CreatePersistedResolution(existing, idempotentCommit: true));
            return;
        }

        EnqueueRouteEvaluation(input, Sender);
    }

    private void HandleDeliveryAttemptOffer(DeliveryAttemptOffer offer)
    {
        var parseResult = RouteDeliveryInputParser.Parse(offer);
        if (parseResult is RouteDeliveryInputParser.RouteDeliveryInputParseResult.Invalid invalid)
        {
            Sender.Tell(new DeliveryRejected(
                offer.DeliveryId,
                offer.Envelope.CommandId,
                offer.Envelope.Recipient,
                invalid.Error), Self);
            return;
        }

        var routeInput = ((RouteDeliveryInputParser.RouteDeliveryInputParseResult.Parsed)parseResult).Input;

        var replyTo = Sender;
        if (_attempts.TryGetValue(routeInput.RoutingAttemptId, out _))
        {
            replyTo.Tell(new DeliveryAccepted(
                offer.DeliveryId,
                offer.Envelope.CommandId,
                offer.Envelope.Recipient,
                "duplicate_routing_attempt_recorded"), Self);
            return;
        }

        EnqueueRouteEvaluation(routeInput, replyTo, successKind: "routing_attempt_recorded", duplicateKind: "duplicate_routing_attempt_recorded", offer);
    }

    private void EnqueueRouteEvaluation(RouteInput input, IActorRef replyTo, string? successKind = null, string? duplicateKind = null, DeliveryAttemptOffer? offer = null)
    {
        if (_attempts.TryGetValue(input.RoutingAttemptId, out var existing))
        {
            if (offer is not null && duplicateKind is not null)
            {
                replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, duplicateKind), Self);
            }
            else
            {
                replyTo.Tell(RouteResolutionFactory.CreatePersistedResolution(existing, idempotentCommit: true));
            }

            return;
        }

        if (_pendingRouteReplies.TryGetValue(input.RoutingAttemptId, out var pending))
        {
            pending.Add(CreatePendingReply(replyTo, successKind, offer));
            return;
        }

        _pendingRouteReplies[input.RoutingAttemptId] = new List<PendingRouteReply> { CreatePendingReply(replyTo, successKind, offer) };
        StartRouteEvaluationAsync(input);
    }

    private static PendingRouteReply CreatePendingReply(IActorRef replyTo, string? successKind, DeliveryAttemptOffer? offer) =>
        new(replyTo, offer, successKind);

    private void StartRouteEvaluationAsync(RouteInput input)
    {
        var self = Self;
        _ = EvaluateRouteAsync(input)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RouteEvaluationCompleted(input, ActorRefs.Nobody, task.Result)
                    : new RouteEvaluationFailed(input, ActorRefs.Nobody, task.Exception?.GetBaseException() ?? new InvalidOperationException("Route evaluation failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(task.Result), TaskScheduler.Default);
    }

    private void ReplyPending(RoutingAttemptId attemptId, Action<PendingRouteReply> reply)
    {
        if (!_pendingRouteReplies.TryGetValue(attemptId, out var waiters))
        {
            return;
        }

        _pendingRouteReplies.Remove(attemptId);
        foreach (var waiter in waiters)
        {
            reply(waiter);
        }
    }

    private async Task<RouteResolution> EvaluateRouteAsync(RouteInput input)
    {
        var profiles = await _roleAgentRegistry.ListProfilesAsync();
        var auditEntries = new List<RouteAuditEntry>();
        var clarificationCandidates = new List<(RoleAgentProfile Profile, WorkOfferNeedsClarification Clarification)>();
        var llmEvaluation = _llmRouting is null ? null : await _llmRouting.EvaluateAsync(input, profiles);
        var llmTrace = llmEvaluation?.Trace;

        if (llmEvaluation?.Decision is { } rankedDecision && string.Equals(rankedDecision.Decision, "clarify", StringComparison.OrdinalIgnoreCase))
        {
            return RouteResolutionFactory.CreateLlmClarification(input, auditEntries, llmTrace, rankedDecision);
        }

        var candidateProfiles = RouteCandidatePlanner.SelectProfilesForEvaluation(profiles, llmEvaluation, llmRoutingEnabled: _llmRouting is not null);
        var accepted = new List<(RoleAgentProfile Profile, WorkOfferAcceptedDecision Accepted)>();

        foreach (var profile in candidateProfiles)
        {
            var offer = RouteCandidatePlanner.CreateOffer(input, profile);

            var decision = await _intakeFactory(profile.RoleAgentId).EvaluateAsync(offer);
            auditEntries.Add(RouteCandidatePlanner.CreateAuditEntry(profile, offer.OfferId, decision));

            switch (decision)
            {
                case WorkOfferAcceptedDecision intakeAccepted:
                    accepted.Add((profile, intakeAccepted));
                    if (_llmRouting is not null)
                    {
                        var commitDecision = await CommitAcceptedAsync(input, auditEntries, llmTrace, profile, intakeAccepted);
                        if (commitDecision is not null)
                        {
                            return commitDecision;
                        }
                    }

                    break;
                case WorkOfferNeedsClarification clarification:
                    clarificationCandidates.Add((profile, clarification));
                    break;
            }
        }

        if (accepted.Count == 1)
        {
            var selected = accepted[0];
            var intake = _intakeFactory(selected.Profile.RoleAgentId);
            var commitResult = await intake.CommitAsync(new WorkClaimCommit(selected.Accepted.OfferId, selected.Accepted.ClaimId));

            if (commitResult is WorkClaimCommitAccepted commitAccepted)
            {
                return RouteResolutionFactory.CreateCommitted(input, auditEntries, llmTrace, selected.Profile.RoleAgentId, selected.Accepted.ClaimId, commitAccepted);
            }

            if (commitResult is WorkClaimCommitRejected rejectedCommit)
            {
                return RouteResolutionFactory.CreateCommitRejected(input, auditEntries, llmTrace, rejectedCommit);
            }
        }

        if (accepted.Count > 1)
        {
            return RouteResolutionFactory.CreateMultipleAcceptedClarification(input, auditEntries, llmTrace, accepted);
        }

        if (clarificationCandidates.Count > 0)
        {
            return RouteResolutionFactory.CreateFirstClarificationCandidate(input, auditEntries, llmTrace, clarificationCandidates[0]);
        }

        return RouteResolutionFactory.CreateFallbackClarification(input, auditEntries, llmTrace);
    }

    private async Task<RouteResolution?> CommitAcceptedAsync(
        RouteInput input,
        List<RouteAuditEntry> auditEntries,
        RouteSelectionTrace? llmTrace,
        RoleAgentProfile profile,
        WorkOfferAcceptedDecision accepted)
    {
        var intake = _intakeFactory(profile.RoleAgentId);
        var commitResult = await intake.CommitAsync(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId));

        if (commitResult is WorkClaimCommitAccepted commitAccepted)
        {
            return RouteResolutionFactory.CreateCommitted(input, auditEntries, llmTrace, profile.RoleAgentId, accepted.ClaimId, commitAccepted);
        }

        if (commitResult is WorkClaimCommitRejected rejectedCommit)
        {
            return RouteResolutionFactory.CreateCommitRejected(input, auditEntries, llmTrace, rejectedCommit);
        }

        return null;
    }

    private void HandleRouteEvaluationCompleted(RouteEvaluationCompleted completed)
    {
        if (_attempts.TryGetValue(completed.Input.RoutingAttemptId, out var existing))
        {
            ReplyPending(completed.Input.RoutingAttemptId, pending =>
            {
                if (pending.Offer is not null)
                {
                    pending.ReplyTo.Tell(new DeliveryAccepted(
                        pending.Offer.DeliveryId,
                        pending.Offer.Envelope.CommandId,
                        pending.Offer.Envelope.Recipient,
                        pending.SuccessAcceptanceKind ?? "duplicate_routing_attempt_recorded"), Self);
                }
                else
                {
                    pending.ReplyTo.Tell(RouteResolutionFactory.CreatePersistedResolution(existing, idempotentCommit: true));
                }
            });
            return;
        }

        PersistAttemptFacts(completed.Resolution.Attempt, 0, persistedAttempt =>
        {
            var resolved = RouteResolutionFactory.RebindToPersistedAttempt(completed.Resolution, persistedAttempt);
            ReplyPending(completed.Input.RoutingAttemptId, pending =>
            {
                if (pending.Offer is not null)
                {
                    pending.ReplyTo.Tell(new DeliveryAccepted(
                        pending.Offer.DeliveryId,
                        pending.Offer.Envelope.CommandId,
                        pending.Offer.Envelope.Recipient,
                        pending.SuccessAcceptanceKind ?? "routing_attempt_recorded"), Self);
                }
                else
                {
                    pending.ReplyTo.Tell(resolved);
                }
            });
        });
    }

    private void HandleRouteEvaluationFailed(RouteEvaluationFailed failed)
    {
        ReplyPending(failed.Input.RoutingAttemptId, pending =>
        {
            if (pending.Offer is not null)
            {
                pending.ReplyTo.Tell(new DeliveryRejected(
                    pending.Offer.DeliveryId,
                    pending.Offer.Envelope.CommandId,
                    pending.Offer.Envelope.Recipient,
                    new OperationError("route_evaluation_failed", failed.Exception.Message, false)), Self);
            }
            else
            {
                pending.ReplyTo.Tell(new Status.Failure(failed.Exception));
            }
        });
    }

    private void HandleRecordRouteAttempt(RecordRouteAttemptCommand command)
    {
        var replyTo = Sender;
        PersistAttemptFacts(command.Attempt, 0, persistedAttempt => replyTo.Tell(persistedAttempt));
    }

    private void HandleGetRouteAttempt(GetRouteAttemptCommand command)
        => Sender.Tell(_attempts.TryGetValue(command.AttemptId, out var attempt) ? attempt : null);

    private void HandleGetRouteResolution(GetRouteResolutionCommand command)
        => Sender.Tell(_attempts.TryGetValue(command.AttemptId, out var attempt)
            ? RouteResolutionFactory.CreatePersistedResolution(attempt, idempotentCommit: true)
            : null);

    private void HandleInspectRouteAttempts(InspectRouteAttempts _)
        => Sender.Tell(new RouteInspection(new Dictionary<RoutingAttemptId, RouteAttemptRecord>(_attempts)));

    private void PersistAttemptFacts(RouteAttemptRecord attempt, int index, Action<RouteAttemptRecord> afterPersist)
    {
        var events = RouteAttemptEventFactory.Create(attempt);
        if (index >= events.Count)
        {
            afterPersist(_attempts[attempt.RoutingAttemptId]);
            return;
        }

        var evt = events[index];
        PersistRoutingFact(evt, attempt.Input.CorrelationId, attempt.Input.RoutingAttemptId, () => PersistAttemptFacts(attempt, index + 1, afterPersist));
    }

    private void PersistRoutingFact(IAvenEvent evt, CorrelationId correlationId, RoutingAttemptId routingAttemptId, Action afterPersist)
    {
        switch (evt)
        {
            case RouteAttemptStarted started:
                PersistEvent(started, MetadataFor<RouteAttemptStarted>(
                    new ActorAddress("intent-router", "local"),
                    nameof(RoleRouterActor),
                    correlationId,
                    started), _ =>
                {
                    Apply(started);
                    afterPersist();
                });
                break;
            case RoleSelectorEvaluationRecorded llm:
                PersistEvent(llm, MetadataFor<RoleSelectorEvaluationRecorded>(
                    new ActorAddress("intent-router", "local"),
                    nameof(RoleRouterActor),
                    correlationId,
                    llm), _ =>
                {
                    Apply(llm);
                    afterPersist();
                });
                break;
            case RouteCandidateEvaluated candidate:
                PersistEvent(candidate, MetadataFor<RouteCandidateEvaluated>(
                    new ActorAddress("intent-router", "local"),
                    nameof(RoleRouterActor),
                    correlationId,
                    candidate), _ =>
                {
                    Apply(candidate);
                    afterPersist();
                });
                break;
            case RoutingCommitted committed:
                PersistEvent(committed, MetadataFor<RoutingCommitted>(
                    new ActorAddress("intent-router", "local"),
                    nameof(RoleRouterActor),
                    correlationId,
                    committed), _ =>
                {
                    Apply(committed);
                    afterPersist();
                });
                break;
            case RoutingClarificationRequested clarification:
                PersistEvent(clarification, MetadataFor<RoutingClarificationRequested>(
                    new ActorAddress("intent-router", "local"),
                    nameof(RoleRouterActor),
                    correlationId,
                    clarification), _ =>
                {
                    Apply(clarification);
                    afterPersist();
                });
                break;
            case RoutingRejected rejected:
                PersistEvent(rejected, MetadataFor<RoutingRejected>(
                    new ActorAddress("intent-router", "local"),
                    nameof(RoleRouterActor),
                    correlationId,
                    rejected), _ =>
                {
                    Apply(rejected);
                    afterPersist();
                });
                break;
            default:
                throw new InvalidOperationException($"Unsupported routing event type '{evt.GetType().Name}' for attempt '{routingAttemptId.Value}'.");
        }
    }

    private void Apply(RouteAttemptStarted started)
    {
        var projection = RoutingAttemptReducer.Apply(GetProjection(started.RoutingAttemptId), started);
        _projections[started.RoutingAttemptId] = projection;
        _attempts[started.RoutingAttemptId] = projection.ToRecord(started.RoutingAttemptId);
    }

    private void Apply(RoleSelectorEvaluationRecorded recorded)
    {
        var projection = RoutingAttemptReducer.Apply(GetProjection(recorded.RoutingAttemptId), recorded);
        _projections[recorded.RoutingAttemptId] = projection;
        _attempts[recorded.RoutingAttemptId] = projection.ToRecord(recorded.RoutingAttemptId);
    }

    private void Apply(RouteCandidateEvaluated evaluated)
    {
        var projection = RoutingAttemptReducer.Apply(GetProjection(evaluated.RoutingAttemptId), evaluated);
        _projections[evaluated.RoutingAttemptId] = projection;
        _attempts[evaluated.RoutingAttemptId] = projection.ToRecord(evaluated.RoutingAttemptId);
    }

    private void Apply(RoutingCommitted committed)
    {
        var projection = RoutingAttemptReducer.Apply(GetProjection(committed.RoutingAttemptId), committed);
        _projections[committed.RoutingAttemptId] = projection;
        _attempts[committed.RoutingAttemptId] = projection.ToRecord(committed.RoutingAttemptId);
    }

    private void Apply(RoutingClarificationRequested requested)
    {
        var projection = RoutingAttemptReducer.Apply(GetProjection(requested.RoutingAttemptId), requested);
        _projections[requested.RoutingAttemptId] = projection;
        _attempts[requested.RoutingAttemptId] = projection.ToRecord(requested.RoutingAttemptId);
    }

    private void Apply(RoutingRejected rejected)
    {
        var projection = RoutingAttemptReducer.Apply(GetProjection(rejected.RoutingAttemptId), rejected);
        _projections[rejected.RoutingAttemptId] = projection;
        _attempts[rejected.RoutingAttemptId] = projection.ToRecord(rejected.RoutingAttemptId);
    }

    private RoutingAttemptProjection? GetProjection(RoutingAttemptId routingAttemptId)
        => _projections.TryGetValue(routingAttemptId, out var projection) ? projection : null;
}
