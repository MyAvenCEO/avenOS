namespace Aven.WorkIntake.Contracts.Models;

public sealed record WorkOffer(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    RoleAgentId CandidateRoleAgentId,
    string IncomingItemRef,
    string InputType,
    IReadOnlyList<string> AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    IReadOnlyList<SchemaRef> RequiredSchemas,
    CorrelationId CorrelationId,
    ActorAddress ReplyTo);
