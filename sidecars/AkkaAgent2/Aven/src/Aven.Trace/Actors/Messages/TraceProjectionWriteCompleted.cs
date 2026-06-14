namespace Aven.Trace.Actors.Messages;

internal sealed record TraceProjectionWriteCompleted(TraceProjectionDelta[] Batch, TraceStoreWriteResult Result, Exception? Error);
