namespace Aven.Toolkit.Tracing;

public sealed record TraceTimelineItemDto(
    DateTimeOffset At,
    string EventId,
    string EventType,
    string Actor,
    string ActorKind,
    string Summary,
    string CorrelationId,
    string? CommandId,
    string? DeliveryId,
    string? OperationKey,
    JsonNode? Details);
