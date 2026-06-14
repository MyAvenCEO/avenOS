namespace Aven.Submission.Contracts.Events;

public sealed record MessageSubmitted(
    string IdempotencyKey,
    string BodyHash,
    string IncomingItemRef,
    string InputType,
    string[] AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    SchemaRef[] RequiredSchemaRefs,
    RoutingAttemptId RoutingAttemptId,
    DeliveryId DeliveryId,
    CommandId CommandId,
    MessageId MessageId,
    DateTimeOffset RecordedAt) : IAvenEvent;
