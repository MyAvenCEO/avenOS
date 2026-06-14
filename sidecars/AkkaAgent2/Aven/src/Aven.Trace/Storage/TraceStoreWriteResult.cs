namespace Aven.Trace.Storage;

public sealed record TraceStoreWriteResult(int EventsWritten, int EntitiesWritten, int LinksWritten);
