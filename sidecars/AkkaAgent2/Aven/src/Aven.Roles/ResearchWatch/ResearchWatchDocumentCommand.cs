namespace Aven.Roles.ResearchWatch;

public sealed record ResearchWatchDocumentCommand(
    RoutingAttemptId RoutingAttemptId,
    WorkOfferId OfferId,
    WorkClaimId ClaimId,
    RoleAgentId RoleAgentId,
    string IncomingItemRef,
    IReadOnlyList<string> AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    IReadOnlyList<SchemaRef> RequiredSchemas,
    CorrelationId CorrelationId,
    ActorAddress ReplyTo);
