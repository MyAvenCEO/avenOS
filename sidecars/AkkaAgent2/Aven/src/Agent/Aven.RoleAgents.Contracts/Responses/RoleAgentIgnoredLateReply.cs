namespace Aven.RoleAgents.Contracts.Responses;

public sealed record RoleAgentIgnoredLateReply(RoleAgentId RoleAgentId, OperationKey Key, string Reason);
