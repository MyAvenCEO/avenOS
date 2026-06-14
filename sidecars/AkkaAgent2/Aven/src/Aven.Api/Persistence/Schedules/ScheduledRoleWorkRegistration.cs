namespace Aven.Api.Persistence.Schedules;

internal sealed record ScheduledRoleWorkRegistration(
    string ScheduleId,
    string RequestId,
    string TargetAgentValue,
    string TargetAgentProtocol,
    string TargetOperationType,
    string CommandPayloadJson,
    CorrelationId CorrelationId,
    DateTimeOffset DueAt,
    string Summary,
    string MissedRunPolicy,
    string? Recurrence);
