using System.Text.Json;
using Aven.WorkIntake.Contracts.Support;

namespace Aven.WorkIntake.Runtime.State;

internal static class WorkIntakeStateReducer
{
    public static WorkIntakeState Apply(WorkIntakeState state, WorkOfferReceived recorded)
    {
        var offer = new WorkOffer(
            recorded.RoutingAttemptId,
            recorded.OfferId,
            recorded.CandidateRoleAgentId,
            recorded.IncomingItemRef,
            string.IsNullOrWhiteSpace(recorded.InputType)
                ? InputTypeNormalizer.InferFromIncomingItemRef(recorded.IncomingItemRef)
                : recorded.InputType,
            recorded.AttachmentRefs,
            recorded.ContentSummary,
            recorded.ProposedIntent,
            recorded.ProposedReason,
            recorded.RequiredSchemas,
            recorded.CorrelationId,
            recorded.ReplyTo);
        var offerState = new WorkOfferState(
            offer,
            recorded.PayloadHash,
            WorkIntakeLifecycleStatus.Open,
            new WorkOfferNeedsClarification(recorded.RoutingAttemptId, recorded.OfferId, recorded.CandidateRoleAgentId, "Decision pending."),
            null,
            null,
            null);

        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        offers[recorded.OfferId] = offerState;
        return state with { Offers = offers };
    }

    public static WorkIntakeState Apply(WorkIntakeState state, WorkOfferAccepted recorded)
    {
        var accepted = new WorkOfferAcceptedDecision(recorded.RoutingAttemptId, recorded.OfferId, recorded.RoleAgentId, recorded.ClaimId, recorded.Confidence, recorded.AcceptedScope, recorded.ExpectedCommandType, recorded.ExpiresAt, recorded.Reason);
        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        var current = offers[recorded.OfferId];
        offers[recorded.OfferId] = current with { Status = WorkIntakeLifecycleStatus.Claimed, Decision = accepted, Accepted = accepted, TerminalError = null };
        var claims = state.Claims.ToDictionary(static x => x.Key, static x => x.Value);
        claims[recorded.ClaimId] = recorded.OfferId;
        return state with { Offers = offers, Claims = claims };
    }

    public static WorkIntakeState Apply(WorkIntakeState state, WorkOfferRejected recorded)
    {
        var rejected = new WorkOfferRejectedDecision(recorded.RoutingAttemptId, recorded.OfferId, recorded.RoleAgentId, recorded.ReasonCode, recorded.Reason, recorded.Retryable, recorded.SuggestedAgentKinds, recorded.SuggestedClarifyingQuestion);
        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        var current = offers[recorded.OfferId];
        offers[recorded.OfferId] = current with { Status = WorkIntakeLifecycleStatus.Rejected, Decision = rejected, TerminalError = new OperationError(recorded.ReasonCode, recorded.Reason, recorded.Retryable) };
        return state with { Offers = offers };
    }

    public static WorkIntakeState Apply(WorkIntakeState state, WorkOfferClarificationRequested recorded)
    {
        var clarification = new WorkOfferNeedsClarification(recorded.RoutingAttemptId, recorded.OfferId, recorded.RoleAgentId, recorded.Question);
        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        var current = offers[recorded.OfferId];
        offers[recorded.OfferId] = current with { Status = WorkIntakeLifecycleStatus.Open, Decision = clarification };
        return state with { Offers = offers };
    }

    public static WorkIntakeState Apply(WorkIntakeState state, WorkClaimCommitRequested recorded)
    {
        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        var current = offers[recorded.OfferId];
        var accepted = current.Accepted ?? throw new InvalidOperationException("Commit requested before offer acceptance was recovered.");
        var commandJson = JsonSerializer.Serialize(WorkIntakeDeliveryPlanner.CreateCommittedCommand(current.Offer, accepted));
        var commit = new WorkClaimCommitRecord(recorded.OfferId, recorded.ClaimId, accepted, current.Offer.CorrelationId, commandJson, recorded.ExpectedCommandType, recorded.DeliveryId, recorded.CommandId, recorded.MessageId, recorded.StartedAt);
        offers[recorded.OfferId] = current with
        {
            Status = WorkIntakeLifecycleStatus.Committing,
            Commit = commit,
            TerminalError = null
        };
        return state with { Offers = offers };
    }

    public static WorkIntakeState Apply(WorkIntakeState state, WorkCommitted recorded)
    {
        if (!state.Claims.TryGetValue(recorded.ClaimId, out var offerId))
        {
            return state;
        }

        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        var current = offers[offerId];
        offers[offerId] = current with
        {
            Status = WorkIntakeLifecycleStatus.Committed,
            Commit = current.Commit is null ? null : current.Commit with { TerminalDelivery = ToReceipt(recorded.DeliveryId, recorded.DeliveryStatus, recorded.AcceptedAt, recorded.AcceptanceKind, recorded.DeliveryError) },
            TerminalError = null
        };
        return state with { Offers = offers };
    }

    public static WorkIntakeState Apply(WorkIntakeState state, WorkClaimDeliveryRejected recorded)
    {
        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        if (!offers.TryGetValue(recorded.OfferId, out var current))
        {
            return state;
        }

        offers[recorded.OfferId] = current with
        {
            Status = WorkIntakeLifecycleStatus.Rejected,
            Commit = current.Commit is null ? null : current.Commit with { TerminalDelivery = recorded.DeliveryId is null || recorded.DeliveryStatus is null ? null : ToReceipt(recorded.DeliveryId.Value, recorded.DeliveryStatus.Value, recorded.AcceptedAt, recorded.AcceptanceKind, recorded.DeliveryError) },
            TerminalError = recorded.Error
        };
        return state with { Offers = offers };
    }

    public static WorkIntakeState Apply(WorkIntakeState state, WorkOfferExpired recorded)
    {
        var offers = state.Offers.ToDictionary(static x => x.Key, static x => x.Value);
        if (!offers.TryGetValue(recorded.OfferId, out var current))
        {
            return state;
        }

        offers[recorded.OfferId] = current with { Status = WorkIntakeLifecycleStatus.Expired, TerminalError = recorded.Error };
        return state with { Offers = offers };
    }

    private static WorkStartDeliveryReceipt ToReceipt(DeliveryId deliveryId, DeliveryStatus status, DateTimeOffset? acceptedAt, string? acceptanceKind, OperationError? error) =>
        new(deliveryId, status, acceptedAt, acceptanceKind, error);
}
