namespace Aven.Toolkit.Tracing;

public sealed record TraceEntityDetail(
    TraceSubjectDto Subject,
    string Status,
    string Summary,
    JsonNode? Details,
    TraceTimelineResult Timeline);
