namespace Aven.Roles.Interfaces;

public interface IRoleBehaviorHandler
{
    string? CreateInitialStateJson();
    bool CanHandle(OperationResolved resolved, RoleBehaviorContext context);
    RoleBehaviorResult Apply(OperationResolved resolved, RoleBehaviorContext context);
    object CreateCommittedCommand(string expectedCommandType, RoleCommittedInput input);
}
