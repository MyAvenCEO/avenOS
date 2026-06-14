namespace Aven.Routing.Contracts.Events;

public sealed record RouteAttemptStarted(
    RoutingAttemptId RoutingAttemptId,
    string IncomingItemRef,
    string InputType,
    string[] AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    SchemaRef[] RequiredSchemaRefs,
    CorrelationId CorrelationId,
    ActorAddress ReplyTo) : IAvenEvent;
