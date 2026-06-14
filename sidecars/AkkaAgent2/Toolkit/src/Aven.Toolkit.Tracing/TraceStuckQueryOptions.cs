namespace Aven.Toolkit.Tracing;

public sealed record TraceStuckQueryOptions(int Limit = 200, TimeSpan? OlderThan = null);
