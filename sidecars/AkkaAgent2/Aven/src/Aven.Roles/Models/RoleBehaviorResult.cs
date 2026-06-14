namespace Aven.Roles.Models;

public sealed record RoleBehaviorResult(
    RoleBehaviorStatus Status,
    string? RoleStateJson,
    IReadOnlyList<RoleOperation> OperationsToRequest,
    string? FinalResult);
