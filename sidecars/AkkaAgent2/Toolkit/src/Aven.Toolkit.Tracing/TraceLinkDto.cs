namespace Aven.Toolkit.Tracing;

public sealed record TraceLinkDto(TraceEntityRefDto From, TraceEntityRefDto To, string Type);
