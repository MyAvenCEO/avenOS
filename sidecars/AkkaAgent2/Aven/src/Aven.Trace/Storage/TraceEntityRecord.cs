namespace Aven.Trace.Storage;

public sealed record TraceEntityRecord(
    string EntityType,
    string EntityId,
    string Status,
    string Summary,
    string? LastEventId,
    DateTimeOffset LastChangedAt,
    string DetailsJson);
