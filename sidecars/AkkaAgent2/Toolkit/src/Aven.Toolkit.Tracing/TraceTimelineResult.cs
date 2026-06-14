namespace Aven.Toolkit.Tracing;

public sealed record TraceTimelineResult(
    TraceSubjectDto Subject,
    string Status,
    string Summary,
    IReadOnlyList<TraceTimelineItemDto> Items,
    IReadOnlyList<TraceLinkDto> Links,
    IReadOnlyList<TraceInvariantDto> Invariants,
    int Limit,
    int Count,
    bool HasMore);
