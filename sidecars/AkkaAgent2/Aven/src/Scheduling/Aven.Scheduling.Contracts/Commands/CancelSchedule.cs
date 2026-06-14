namespace Aven.Scheduling.Contracts.Commands;

public sealed record CancelSchedule(string Reason, DateTimeOffset? CancelledAt = null);
