namespace Aven.Trace.Storage;

public sealed record TraceLinkRecord(
    string FromEntityType,
    string FromEntityId,
    string ToEntityType,
    string ToEntityId,
    string LinkType,
    string EventId,
    DateTimeOffset CreatedAt);
