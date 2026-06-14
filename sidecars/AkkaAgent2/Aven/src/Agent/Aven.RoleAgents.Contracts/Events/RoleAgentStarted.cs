namespace Aven.RoleAgents.Contracts.Events;

public sealed record RoleAgentStarted(
    RoleAgentId RoleAgentId,
    string RoleName,
    string RoleDisplayName,
    string Objective,
    RoleAgentStatus InitialStatus,
    string? RoleMemoryJson) : IAvenEvent;
