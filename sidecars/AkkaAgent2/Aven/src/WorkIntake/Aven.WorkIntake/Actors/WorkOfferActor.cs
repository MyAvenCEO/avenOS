using Aven.WorkIntake.Runtime.Commit;
using Aven.WorkIntake.Runtime.Delivery;
using Aven.WorkIntake.Runtime.Evaluation;
using Aven.WorkIntake.Runtime.Events;
using Aven.WorkIntake.Runtime.Hashing;
using Aven.WorkIntake.Runtime.State;

using System.Text.Json;
using Akka.Actor;
using Akka.Persistence;
using Aven.ActorKernel;
using Aven.DurableDelivery;
using Aven.WorkIntake.Runtime;
using WorkOfferAcceptedEvent = Aven.WorkIntake.Contracts.Events.WorkOfferAccepted;
using WorkOfferRejectedEvent = Aven.WorkIntake.Contracts.Events.WorkOfferRejected;

namespace Aven.WorkIntake.Actors;

public sealed class WorkOfferActor : AvenPersistentActor
{
    private static readonly DeliveryPolicy CommittedWorkDeliveryPolicy = new(TimeSpan.FromMilliseconds(100), 20);

    private readonly RoleAgentId _agentId;
    private readonly ActorAddress _intakeAddress;
    private readonly Func<RoleAgentState> _agentStateProvider;
    private readonly Func<WorkOffer, RoleAgentState, WorkOfferDecision>? _decisionFactory;
    private readonly IActorAddressResolver? _resolver;
    private readonly DurableDeliveryFactory? _deliveryLauncher;
    private readonly ActorAddress? _agentAddress;
    private WorkIntakeState _state;

    public WorkOfferActor(
        string persistenceId,
        RoleAgentId agentId,
        Func<RoleAgentState> agentStateProvider,
        Func<WorkOffer, RoleAgentState, WorkOfferDecision>? decisionFactory = null,
        IActorAddressResolver? resolver = null,
        ActorAddress? agentAddress = null)
    {
        PersistenceId = persistenceId;
        _agentId = agentId;
        _agentStateProvider = agentStateProvider;
        _decisionFactory = decisionFactory;
        _resolver = resolver;
        _deliveryLauncher = resolver is null ? null : new DurableDeliveryFactory(resolver);
        _agentAddress = agentAddress;
        _intakeAddress = new ActorAddress($"intake/{_agentId.Value}", "local");
        _state = WorkIntakeState.Empty(agentId);

        RecoverEvent<WorkOfferReceived>(Apply);
        RecoverEvent<WorkOfferAcceptedEvent>(Apply);
        RecoverEvent<WorkOfferRejectedEvent>(Apply);
        RecoverEvent<WorkOfferClarificationRequested>(Apply);
        RecoverEvent<WorkClaimCommitRequested>(Apply);
        RecoverEvent<WorkClaimDeliveryRequested>(_ => { });
        RecoverEvent<WorkCommitted>(Apply);
        RecoverEvent<WorkClaimDeliveryRejected>(Apply);
        RecoverEvent<WorkOfferExpired>(Apply);
        Recover<RecoveryCompleted>(_ =>
        {
            if (_resolver is IActorAddressRegistry registry)
            {
                registry.Register(_intakeAddress, Self);
            }

            ResumePendingCommits();
        });

        RegisterHandlers();
    }

    public override string PersistenceId { get; }

    private void RegisterHandlers()
    {
        Command<InspectWorkIntake>(HandleInspect);
        Command<WorkIntakeDeliveryCompleted>(HandleDeliveryCompleted);
        Command<WorkIntakeDeliveryFailed>(HandleDeliveryFailed);
        Command<DeliveryTerminalSignal>(HandleTerminalNotification);
        Command<EvaluateWorkOfferCommand>(command => HandleEvaluate(command.Offer));
        Command<WorkClaimCommitCommand>(command => HandleCommit(command.Commit));
    }

    private void HandleInspect(InspectWorkIntake _) => Sender.Tell(_state);

    private void ResumePendingCommits()
    {
        foreach (var offerState in _state.Offers.Values.Where(static x => x.Status == WorkIntakeLifecycleStatus.Committing && x.Commit is not null))
        {
            StartDelivery(offerState.Commit!);
        }
    }

    private void HandleEvaluate(WorkOffer offer)
    {
        var plan = WorkOfferEvaluationPlanner.Plan(_state, offer);
        switch (plan)
        {
            case WorkOfferEvaluationPlanner.WorkOfferEvaluationPlan.Existing existing:
                Sender.Tell(existing.Decision);
                return;
            case WorkOfferEvaluationPlanner.WorkOfferEvaluationPlan.Conflict conflict:
                Sender.Tell(conflict.Rejection);
                return;
            case WorkOfferEvaluationPlanner.WorkOfferEvaluationPlan.New created:
                HandleNewOfferEvaluation(offer, created);
                return;
            default:
                throw new InvalidOperationException($"Unsupported evaluation plan '{plan.GetType().Name}'.");
        }
    }

    private void HandleNewOfferEvaluation(WorkOffer offer, WorkOfferEvaluationPlanner.WorkOfferEvaluationPlan.New created)
    {
        WorkOfferDecision decision;
        try
        {
            decision = _decisionFactory?.Invoke(offer, _agentStateProvider()) ?? CreateDefaultDecision(offer);
        }
        catch (Exception ex)
        {
            Sender.Tell(CreateDecisionFailure(offer, "work_offer_decision_failed", ex.Message, retryable: true));
            return;
        }

        var received = CreateOfferReceived(offer, created.PayloadHash);
        var replyTo = Sender;
        PersistEvent(received, MetadataFor<WorkOfferReceived>(
            _intakeAddress,
            nameof(WorkOfferActor),
            offer.CorrelationId,
            received), persisted =>
        {
            Apply(persisted);
            PersistDecision(offer, decision, replyTo);
        });
    }

    private void PersistDecision(WorkOffer offer, WorkOfferDecision decision, IActorRef replyTo)
    {
        var evt = WorkOfferDecisionEventFactory.CreateDecisionEvent(decision);
        switch (evt)
        {
            case WorkOfferAcceptedEvent acceptedEvent:
                PersistEvent(acceptedEvent, MetadataFor<WorkOfferAcceptedEvent>(_intakeAddress, nameof(WorkOfferActor), offer.CorrelationId, acceptedEvent), persisted =>
                {
                    Apply(persisted);
                    replyTo.Tell(decision);
                });
                break;
            case WorkOfferRejectedEvent rejectedEvent:
                PersistEvent(rejectedEvent, MetadataFor<WorkOfferRejectedEvent>(_intakeAddress, nameof(WorkOfferActor), offer.CorrelationId, rejectedEvent), persisted =>
                {
                    Apply(persisted);
                    replyTo.Tell(decision);
                });
                break;
            case WorkOfferClarificationRequested clarificationEvent:
                PersistEvent(clarificationEvent, MetadataFor<WorkOfferClarificationRequested>(_intakeAddress, nameof(WorkOfferActor), offer.CorrelationId, clarificationEvent), persisted =>
                {
                    Apply(persisted);
                    replyTo.Tell(decision);
                });
                break;
            default:
                throw new InvalidOperationException($"Unsupported decision event type '{evt.GetType().Name}'.");
        }
    }

    private static WorkOfferReceived CreateOfferReceived(WorkOffer offer, string payloadHash) =>
        new(
            offer.RoutingAttemptId,
            offer.OfferId,
            offer.CandidateRoleAgentId,
            offer.IncomingItemRef,
            offer.AttachmentRefs.ToArray(),
            offer.ContentSummary,
            offer.ProposedIntent,
            offer.ProposedReason,
            offer.RequiredSchemas.ToArray(),
            offer.CorrelationId,
            offer.ReplyTo,
            payloadHash,
            offer.InputType);

    private void HandleCommit(WorkClaimCommit commit)
    {
        var plan = WorkClaimCommitPlanner.Plan(_state, commit, DateTimeOffset.UtcNow, deliveryAvailable: _resolver is not null && _agentAddress is not null);
        switch (plan)
        {
            case WorkClaimCommitPlanner.WorkClaimCommitPlan.Reject reject:
                Sender.Tell(reject.Rejection);
                return;
            case WorkClaimCommitPlanner.WorkClaimCommitPlan.Resume resume:
                Sender.Tell(resume.Reply);
                return;
            case WorkClaimCommitPlanner.WorkClaimCommitPlan.Expire expire:
                PersistExpiredCommit(expire.Event, Sender);
                return;
            case WorkClaimCommitPlanner.WorkClaimCommitPlan.Start start:
                StartCommit(start, Sender);
                return;
            default:
                throw new InvalidOperationException($"Unsupported commit plan '{plan.GetType().Name}'.");
        }
    }

    private void PersistExpiredCommit(WorkOfferExpired expired, IActorRef replyTo)
    {
        var offerState = _state.Offers[expired.OfferId];
        PersistEvent(expired, MetadataFor<WorkOfferExpired>(
            _intakeAddress,
            nameof(WorkOfferActor),
            offerState.Offer.CorrelationId,
            expired,
            deliveryId: offerState.Commit?.DeliveryId,
            commandId: offerState.Commit?.CommandId), persisted =>
        {
            Apply(persisted);
            replyTo.Tell(new WorkClaimCommitRejected(expired.OfferId, persisted.Error));
        });
    }

    private void StartCommit(WorkClaimCommitPlanner.WorkClaimCommitPlan.Start startPlan, IActorRef replyTo)
    {
        var agentAddress = _agentAddress ?? throw new InvalidOperationException("Agent intake delivery target is unavailable.");
        var deliveryPlan = WorkIntakeDeliveryPlanner.CreatePlan(
            _intakeAddress,
            agentAddress,
            CommittedWorkDeliveryPolicy,
            startPlan.OfferState.Offer,
            startPlan.Accepted,
            startPlan.Event);
        var startEvent = startPlan.Event with { ExpectedCommandJsonHash = deliveryPlan.CommandJsonHash };

        PersistEvent(startEvent, MetadataFor<WorkClaimCommitRequested>(
            _intakeAddress,
            nameof(WorkOfferActor),
            startPlan.OfferState.Offer.CorrelationId,
            startEvent,
            deliveryId: startEvent.DeliveryId,
            commandId: startEvent.CommandId), persisted =>
        {
            Apply(persisted);
            var requested = new WorkClaimDeliveryRequested(persisted.OfferId, persisted.ClaimId, persisted.DeliveryId, persisted.CommandId);
            PersistEvent(requested, MetadataFor<WorkClaimDeliveryRequested>(
                _intakeAddress,
                nameof(WorkOfferActor),
                startPlan.OfferState.Offer.CorrelationId,
                requested,
                deliveryId: persisted.DeliveryId,
                commandId: persisted.CommandId), _ =>
            {
                StartDelivery(_state.Offers[persisted.OfferId].Commit!);
                replyTo.Tell(new WorkClaimCommitAccepted(persisted.OfferId, persisted.ClaimId, false));
            });
        });
    }

    private static WorkOfferRejectedDecision CreateDecisionFailure(WorkOffer offer, string code, string message, bool retryable) =>
        new(
            offer.RoutingAttemptId,
            offer.OfferId,
            offer.CandidateRoleAgentId,
            code,
            message,
            retryable,
            Array.Empty<string>());

    private WorkOfferDecision CreateDefaultDecision(WorkOffer offer)
    {
        var role = BuiltInRoleDefinitionCatalog.Get(_agentStateProvider().RoleProfile.RoleName);
        return WorkOfferDefaultDecisionPlanner.Decide(_agentId, role, offer, DateTimeOffset.UtcNow);
    }

    private void StartDelivery(WorkClaimCommitRecord commit)
    {
        if (_resolver is null)
        {
            throw new InvalidOperationException("Agent intake delivery resolver is unavailable.");
        }

        if (!_state.Offers.TryGetValue(commit.OfferId, out var offerState))
        {
            throw new InvalidOperationException($"Offer '{commit.OfferId.Value}' was not found for commit delivery.");
        }

        if (_agentAddress is not { } agentAddress)
        {
            throw new InvalidOperationException("Agent intake delivery target is unavailable.");
        }

        var deliveryPlan = WorkIntakeDeliveryPlanner.CreatePlan(
            _intakeAddress,
            agentAddress,
            CommittedWorkDeliveryPolicy,
            offerState.Offer,
            commit);

        (_deliveryLauncher ?? throw new InvalidOperationException("Agent intake delivery launcher is unavailable."))
            .StartOrResume(
                Context,
                PersistenceId,
                deliveryPlan.Start);
    }

    private void HandleTerminalNotification(DeliveryTerminalSignal notification)
    {
        var offerState = _state.Offers.Values.FirstOrDefault(x => x.Commit?.DeliveryId == notification.DeliveryId);
        if (offerState?.Commit is null || offerState.Status != WorkIntakeLifecycleStatus.Committing)
        {
            return;
        }

        Self.Tell(new WorkIntakeDeliveryCompleted(notification.DeliveryId, notification.State, ActorRefs.Nobody));
    }

    private void HandleDeliveryCompleted(WorkIntakeDeliveryCompleted completed)
    {
        var offerState = _state.Offers.Values.FirstOrDefault(x => x.Commit?.DeliveryId == completed.DeliveryId);
        if (offerState is null || offerState.Commit is null || offerState.Status != WorkIntakeLifecycleStatus.Committing)
        {
            return;
        }

        if (completed.Terminal.Status == DeliveryStatus.Accepted)
        {
            var evt = new WorkCommitted(
                offerState.Commit.ClaimId,
                completed.Terminal.DeliveryId,
                completed.Terminal.Status,
                completed.Terminal.AcceptedAt,
                "recipient_accepted",
                completed.Terminal.TerminalError);
            PersistEvent(evt, MetadataFor<WorkCommitted>(
                _intakeAddress,
                nameof(WorkOfferActor),
                offerState.Offer.CorrelationId,
                evt,
                deliveryId: offerState.Commit.DeliveryId,
                commandId: offerState.Commit.CommandId), persisted =>
            {
                Apply(persisted);
            });
            return;
        }

        var rejected = new WorkClaimDeliveryRejected(
            offerState.OfferId,
            completed.Terminal.TerminalError ?? new OperationError("agent_delivery_not_accepted", $"Committed intake delivery ended with status {completed.Terminal.Status}.", false),
            completed.Terminal.DeliveryId,
            completed.Terminal.Status,
            completed.Terminal.AcceptedAt,
            null,
            completed.Terminal.TerminalError);
        PersistEvent(rejected, MetadataFor<WorkClaimDeliveryRejected>(
            _intakeAddress,
            nameof(WorkOfferActor),
            offerState.Offer.CorrelationId,
            rejected,
            deliveryId: offerState.Commit.DeliveryId,
            commandId: offerState.Commit.CommandId), persisted =>
        {
            Apply(persisted);
        });
    }

    private void HandleDeliveryFailed(WorkIntakeDeliveryFailed failed)
    {
        var offerState = _state.Offers.Values.FirstOrDefault(x => x.Commit?.DeliveryId == failed.DeliveryId);
        if (offerState is null)
        {
            if (!failed.ReplyTo.IsNobody())
            {
                failed.ReplyTo.Tell(new WorkClaimCommitRejected(new WorkOfferId("unknown"), failed.Error));
            }

            return;
        }

        if (offerState.Commit is null || offerState.Status != WorkIntakeLifecycleStatus.Committing)
        {
            return;
        }

        var rejected = new WorkClaimDeliveryRejected(offerState.OfferId, failed.Error);
        PersistEvent(rejected, MetadataFor<WorkClaimDeliveryRejected>(
            _intakeAddress,
            nameof(WorkOfferActor),
            offerState.Offer.CorrelationId,
            rejected,
            deliveryId: offerState.Commit?.DeliveryId,
            commandId: offerState.Commit?.CommandId), persisted =>
        {
            Apply(persisted);
            if (!failed.ReplyTo.IsNobody())
            {
                failed.ReplyTo.Tell(new WorkClaimCommitRejected(offerState.OfferId, persisted.Error));
            }
        });
    }

    private void Apply(WorkOfferReceived recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);

    private void Apply(WorkOfferAcceptedEvent recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);

    private void Apply(WorkOfferRejectedEvent recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);

    private void Apply(WorkOfferClarificationRequested recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);

    private void Apply(WorkClaimCommitRequested recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);

    private void Apply(WorkCommitted recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);

    private void Apply(WorkClaimDeliveryRejected recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);

    private void Apply(WorkOfferExpired recorded) => _state = WorkIntakeStateReducer.Apply(_state, recorded);
}
