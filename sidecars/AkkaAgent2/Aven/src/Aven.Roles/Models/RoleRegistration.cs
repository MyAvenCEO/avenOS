namespace Aven.Roles.Models;

public sealed record RoleRegistration(
    RoleProfile Profile,
    IReadOnlyList<RoleInputContract> Inputs,
    IReadOnlyList<RoleOutputContract> Outputs,
    RoleAgentPolicy Policy);
