using System.Text.Json;
using Aven.Contracts.Protocol.Envelopes;
using Aven.DurableDelivery.Contracts.Protocol;

namespace Aven.WorkIntake.Runtime.Delivery;

internal static class WorkIntakeDeliveryPlanner
{
    internal sealed record DeliveryPlan(
        object CommittedCommand,
        string CommandJson,
        string CommandJsonHash,
        CommittedWorkItem WorkItem,
        string Payload,
        AvenEnvelope<string> Envelope,
        DurableDeliveryStart Start);

    public static object CreateCommittedCommand(WorkOffer offer, WorkOfferAcceptedDecision accepted) =>
        BuiltInRoleBehaviorCatalog.CreateCommittedCommand(
            accepted.ExpectedCommandType,
            new RoleCommittedInput(
                accepted.RoutingAttemptId,
                accepted.OfferId,
                accepted.ClaimId,
                accepted.RoleAgentId,
                offer.IncomingItemRef,
                offer.AttachmentRefs,
                offer.ContentSummary,
                offer.ProposedIntent,
                offer.ProposedReason,
                offer.RequiredSchemas,
                offer.CorrelationId,
                offer.ReplyTo));


    public static DeliveryPlan CreatePlan(
        ActorAddress intakeAddress,
        ActorAddress agentAddress,
        DeliveryPolicy policy,
        WorkOffer offer,
        WorkClaimCommitRecord commit)
        => CreatePlan(
            intakeAddress,
            agentAddress,
            policy,
            offer,
            commit.Accepted,
            new WorkClaimCommitRequested(
                commit.OfferId,
                commit.ClaimId,
                WorkOfferHasher.ComputeHashText(commit.ExpectedCommandJson),
                commit.ExpectedCommandType,
                commit.DeliveryId,
                commit.CommandId,
                commit.MessageId,
                commit.StartedAt));

    public static DeliveryPlan CreatePlan(
        ActorAddress intakeAddress,
        ActorAddress agentAddress,
        DeliveryPolicy policy,
        WorkOffer offer,
        WorkOfferAcceptedDecision accepted,
        WorkClaimCommitRequested startEvent)
    {
        var committedCommand = CreateCommittedCommand(offer, accepted);
        var commandJson = JsonSerializer.Serialize(committedCommand);
        var workItem = new CommittedWorkItem(
            startEvent.ClaimId,
            accepted.RoutingAttemptId,
            accepted.RoleAgentId,
            offer.IncomingItemRef,
            offer.AttachmentRefs,
            offer.ContentSummary,
            accepted.ExpectedCommandType,
            commandJson,
            accepted.AcceptedScope,
            offer.CorrelationId,
            offer.ReplyTo,
            offer.ProposedIntent,
            offer.ProposedReason);
        var payload = JsonSerializer.Serialize(workItem);
        var envelope = AvenEnvelopeBuilder
            .ForMessage(CommittedWorkItem.MessageType, payload)
            .From(intakeAddress)
            .To(agentAddress)
            .ReplyTo(intakeAddress)
            .WithCorrelation(offer.CorrelationId)
            .WithCommandId(startEvent.CommandId)
            .WithMessageId(startEvent.MessageId)
            .WithCreatedAt(startEvent.StartedAt)
            .Build();
        var start = DurableDeliveryStartFactory.ForEnvelope(envelope)
            .OwnedBy(intakeAddress)
            .WithDeliveryId(startEvent.DeliveryId)
            .WithPolicy(policy)
            .NotifyTerminal(intakeAddress)
            .Build();
        return new DeliveryPlan(
            committedCommand,
            commandJson,
            WorkOfferHasher.ComputeHashText(commandJson),
            workItem,
            payload,
            envelope,
            start);
    }
}
