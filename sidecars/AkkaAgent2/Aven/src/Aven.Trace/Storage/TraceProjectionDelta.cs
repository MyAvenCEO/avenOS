namespace Aven.Trace.Storage;

public sealed record TraceProjectionDelta(
    TraceEventRecord Event,
    IReadOnlyList<TraceEntityRecord> Entities,
    IReadOnlyList<TraceLinkRecord> Links);
