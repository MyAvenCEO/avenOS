namespace Aven.Scheduling.Contracts.Models;

public sealed record ScheduledWorkItem(
    string Kind,
    DateTimeOffset DueAt,
    DateTimeOffset FiredAt,
    string PayloadJson,
    string PayloadHash,
    int PayloadSizeBytes);
