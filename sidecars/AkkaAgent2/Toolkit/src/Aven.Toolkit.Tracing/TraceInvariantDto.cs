namespace Aven.Toolkit.Tracing;

public sealed record TraceInvariantDto(
    string InvariantId,
    string Severity,
    string Status,
    string EntityType,
    string EntityId,
    string Message,
    DateTimeOffset FirstSeenAt,
    DateTimeOffset LastSeenAt,
    JsonNode? Details);
