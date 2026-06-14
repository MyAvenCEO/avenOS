namespace Aven.Api.Persistence.Schedules;

internal sealed record ScheduledRoleWorkRegistered(
    string ScheduleId,
    RoleAgentId RoleAgentId,
    OperationKey OperationKey,
    CorrelationId CorrelationId,
    string RoleName,
    DateTimeOffset DueAt,
    TimeSpan? Recurrence,
    string PayloadJson,
    string PayloadHash,
    int PayloadSizeBytes) : IAvenEvent;
