namespace Aven.RoleAgents.Runtime;

internal sealed record RoleAgentStateTransition(
    RoleAgentState State,
    IReadOnlyList<OperationId> OperationTimeoutsToCancel)
{
    public static RoleAgentStateTransition None(RoleAgentState state) => new(state, Array.Empty<OperationId>());
}