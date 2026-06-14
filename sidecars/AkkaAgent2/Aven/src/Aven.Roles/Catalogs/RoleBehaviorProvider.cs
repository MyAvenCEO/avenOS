using Aven.Roles.Dynamic;

namespace Aven.Roles.Catalogs;

public static class RoleBehaviorProvider
{
    public static IRoleBehaviorHandler? CreateHandler(RoleProfile profile, string objective)
    {
        var builtIn = BuiltInRoleBehaviorCatalog.GetHandler(profile.RoleName);
        if (builtIn is not null && profile.ExecutionMode != RoleExecutionMode.Dynamic)
        {
            return builtIn;
        }

        if (profile.ExecutionMode == RoleExecutionMode.Dynamic || builtIn is null)
        {
            return new DynamicRoleBehaviorHandler(profile, objective);
        }

        return builtIn;
    }
}
