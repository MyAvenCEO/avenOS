namespace Aven.Toolkit.Tracing;

public sealed record TraceQueryOptions(int Limit = 200, DateTimeOffset? From = null, DateTimeOffset? To = null, bool IncludeDetails = true);
