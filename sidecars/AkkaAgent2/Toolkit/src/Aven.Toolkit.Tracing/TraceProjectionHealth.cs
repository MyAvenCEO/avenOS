namespace Aven.Toolkit.Tracing;

public sealed record TraceProjectionHealth(
    bool Healthy,
    long EventsSeen,
    long EventsWritten,
    int FailureCount,
    string? LastError,
    int BufferedEvents,
    bool FlushInProgress,
    long EventsDropped,
    int ManualFlushesRejected);
