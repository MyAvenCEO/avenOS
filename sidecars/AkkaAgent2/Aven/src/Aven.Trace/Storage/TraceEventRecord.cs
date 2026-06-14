namespace Aven.Trace.Storage;

public sealed record TraceEventRecord(
    string EventId,
    string EventType,
    int EventVersion,
    string ActorAddress,
    string ActorKind,
    string? CommandId,
    string? DeliveryId,
    string? OperationKey,
    string CorrelationId,
    string? CausationId,
    string PayloadHash,
    DateTimeOffset OccurredAt,
    string Summary,
    string DetailsJson,
    bool DetailsTruncated);
