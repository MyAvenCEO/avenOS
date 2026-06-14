namespace Aven.RoleAgents.Runtime;

internal sealed record RoleAgentOperationDispatchResult(IReadOnlyList<string> DispatchedOperationIds);