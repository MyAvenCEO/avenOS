namespace Aven.Routing.Contracts.Models;

public sealed record RouteInput(
    RoutingAttemptId RoutingAttemptId,
    string IncomingItemRef,
    string InputType,
    IReadOnlyList<string> AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    IReadOnlyList<SchemaRef> RequiredSchemas,
    CorrelationId CorrelationId,
    ActorAddress ReplyTo);
