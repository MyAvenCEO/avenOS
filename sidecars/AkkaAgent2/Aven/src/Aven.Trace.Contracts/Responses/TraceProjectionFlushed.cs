namespace Aven.Trace.Contracts.Responses;

public sealed record TraceProjectionFlushed(int EventsWritten, int EntitiesWritten, int LinksWritten);
