namespace Aven.Roles.Enums;

public enum RoleBehaviorStatus
{
    Idle,
    WaitingForOperation,
    WaitingForHuman,
    Blocked,
    Failed,
    Cancelled
}
