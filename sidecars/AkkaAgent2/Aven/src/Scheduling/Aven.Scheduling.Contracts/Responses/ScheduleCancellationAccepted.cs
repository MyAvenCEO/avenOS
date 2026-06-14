namespace Aven.Scheduling.Contracts.Responses;

public sealed record ScheduleCancellationAccepted(string ScheduleId, string Reason, bool Idempotent);