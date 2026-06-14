namespace Aven.RoleAgents.Contracts.Protocol;

public sealed record ScheduledWorkTriggered(
    string ScheduleId,
    string OccurrenceId,
    string CommandType,
    string CommandJson,
    DateTimeOffset DueAt,
    DateTimeOffset FiredAt)
{
    public const string MessageType = "agent.input.scheduled";
}