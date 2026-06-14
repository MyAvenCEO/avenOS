namespace Aven.Api.Views;

public sealed record ScheduleInspectionView(string ScheduleId, DateTimeOffset DueAt, string Status, int FireCount, string? PendingPrompt);
