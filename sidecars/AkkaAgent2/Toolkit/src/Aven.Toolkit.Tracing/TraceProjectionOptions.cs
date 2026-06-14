namespace Aven.Toolkit.Tracing;

public sealed record TraceProjectionOptions(
    int BatchSize = 100,
    TimeSpan? FlushInterval = null,
    int MaxBufferedEvents = 10_000,
    int MaxManualFlushWaiters = 100);
