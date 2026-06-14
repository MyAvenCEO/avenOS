namespace Aven.WorkIntake.Contracts.Events;

public sealed record WorkOfferReceived(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId CandidateRoleAgentId,
    string IncomingItemRef,
    string[] AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    SchemaRef[] RequiredSchemas,
    CorrelationId CorrelationId,
    ActorAddress ReplyTo,
    string PayloadHash,
    string InputType = "") : IAvenEvent;
