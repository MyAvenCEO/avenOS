namespace Aven.Submission.Models;

internal sealed class SubmittedMessageProjection
{
    private static readonly ActorAddress RoutingRecipient = new("routing/role", "local");

    public MessageSubmitted? Received { get; private set; }
    public RoutingDeliveryAccepted? DeliveryAccepted { get; private set; }
    public RoutingDeliveryRejected? DeliveryRejected { get; private set; }
    public RouteResolutionRecorded? DecisionRecorded { get; private set; }
    public SubmissionRejected? Rejected { get; private set; }
    public SubmissionConflictRecorded? Conflict { get; private set; }

    public void Apply(MessageSubmitted received) => Received = received;
    public void Apply(RoutingDeliveryAccepted accepted) => DeliveryAccepted = accepted;
    public void Apply(RoutingDeliveryRejected rejected) => DeliveryRejected = rejected;
    public void Apply(RouteResolutionRecorded recorded) => DecisionRecorded = recorded;
    public void Apply(SubmissionRejected rejected) => Rejected = rejected;
    public void Apply(SubmissionConflictRecorded conflict) => Conflict = conflict;

    public SubmittedMessageRecord ToRecord()
    {
        if (Conflict is not null)
        {
            return new SubmittedMessageRecord(
                Conflict.IdempotencyKey,
                Conflict.ExistingBodyHash,
                SubmittedMessageStatus.Conflict,
                Conflict.ConflictedAt,
                Received?.RoutingAttemptId,
                BuildDelivery(),
                BuildDecision(),
                Conflict.Error);
        }

        var received = Received ?? throw new InvalidOperationException("Submission record projection is missing received event.");
        if (Rejected is null && DeliveryRejected is not null)
        {
            return new SubmittedMessageRecord(
                received.IdempotencyKey,
                received.BodyHash,
                SubmittedMessageStatus.Rejected,
                received.RecordedAt,
                received.RoutingAttemptId,
                BuildDelivery(),
                BuildDecision(),
                DeliveryRejected.Error);
        }

        if (Rejected is not null)
        {
            return new SubmittedMessageRecord(
                Rejected.IdempotencyKey,
                Rejected.BodyHash,
                SubmittedMessageStatus.Rejected,
                Rejected.RejectedAt,
                Rejected.RoutingAttemptId,
                BuildDelivery(),
                BuildDecision(),
                Rejected.Error);
        }

        return new SubmittedMessageRecord(
            received.IdempotencyKey,
            received.BodyHash,
            SubmittedMessageStatus.Accepted,
            received.RecordedAt,
            received.RoutingAttemptId,
            BuildDelivery(),
            BuildDecision(),
            null);
    }

    private DeliveryState? BuildDelivery()
    {
        if (Received is null)
        {
            return null;
        }

        if (DeliveryAccepted is not null)
        {
            return new DeliveryState(
                Received.DeliveryId,
                new ActorAddress("submission/http", "local"),
                string.Empty,
                RoutingRecipient,
                Received.CommandId,
                Received.BodyHash,
                DeliveryStatus.Accepted,
                1,
                null,
                DeliveryAccepted.AcceptedAt,
                null);
        }

        if (DeliveryRejected is not null)
        {
            return new DeliveryState(
                Received.DeliveryId,
                new ActorAddress("submission/http", "local"),
                string.Empty,
                RoutingRecipient,
                Received.CommandId,
                Received.BodyHash,
                DeliveryStatus.Rejected,
                1,
                null,
                null,
                DeliveryRejected.Error);
        }

        return null;
    }

    private RouteResolution? BuildDecision()
    {
        if (Received is null || DecisionRecorded is null)
        {
            return null;
        }

        var attemptStatus = DecisionRecorded.DecisionKind switch
        {
            nameof(RouteCommitted) => RouteAttemptStatus.Routed,
            nameof(RouteNeedsClarification) => RouteAttemptStatus.ClarificationRequired,
            nameof(RouteRejected) => RouteAttemptStatus.Rejected,
            _ => throw new InvalidOperationException($"Unsupported ingress routing decision kind '{DecisionRecorded.DecisionKind}'.")
        };

        var attempt = new RouteAttemptRecord(
            Received.RoutingAttemptId,
            new RouteInput(
                Received.RoutingAttemptId,
                Received.IncomingItemRef,
                Received.InputType,
                Received.AttachmentRefs,
                Received.ContentSummary,
                Received.ProposedIntent,
                Received.ProposedReason,
                Received.RequiredSchemaRefs,
                new CorrelationId($"corr-{Received.IdempotencyKey}"),
                new ActorAddress("submission/http", "local")),
            attemptStatus,
            Array.Empty<RouteAuditEntry>(),
            DecisionRecorded.SelectedRoleAgentId,
            DecisionRecorded.SelectedClaimId,
            DecisionRecorded.ClarificationQuestion ?? DecisionRecorded.Reason);
        attempt = attempt with { ClarificationCandidateRoleAgentIds = DecisionRecorded.CandidateRoleAgentIds };

        return DecisionRecorded.DecisionKind switch
        {
            nameof(RouteCommitted) => new RouteCommitted(
                attempt,
                DecisionRecorded.SelectedRoleAgentId ?? throw new InvalidOperationException("Resolved route decision is missing selected agent id."),
                DecisionRecorded.SelectedClaimId ?? throw new InvalidOperationException("Resolved route decision is missing selected claim id."),
                new WorkClaimCommitAccepted(
                    new WorkOfferId($"offer-{Received.RoutingAttemptId.Value}"),
                    DecisionRecorded.SelectedClaimId ?? throw new InvalidOperationException("Resolved route decision is missing selected claim id."),
                    false)),
            nameof(RouteNeedsClarification) => new RouteNeedsClarification(
                attempt,
                DecisionRecorded.ClarificationQuestion ?? "Clarification required.",
                DecisionRecorded.CandidateRoleAgentIds),
            nameof(RouteRejected) => new RouteRejected(
                attempt,
                DecisionRecorded.Reason ?? "Routing rejected."),
            _ => throw new InvalidOperationException($"Unsupported ingress routing decision kind '{DecisionRecorded.DecisionKind}'.")
        };
    }
}
