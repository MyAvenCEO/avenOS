namespace Aven.Roles.Models;

public sealed record RoleBehaviorContext(
    RoleAgentId RoleAgentId,
    string? RoleStateJson,
    IReadOnlyList<RoleOperation> OutstandingOperations);
