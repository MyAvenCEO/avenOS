namespace Aven.RoleAgents.Contracts.Protocol;

public sealed record CommittedWorkItem(
    WorkClaimId ClaimId,
    RoutingAttemptId RoutingAttemptId,
    RoleAgentId RoleAgentId,
    string SourceItemRef,
    IReadOnlyList<string> AttachmentRefs,
    string ContentSummary,
    string CommandType,
    string CommandJson,
    string AcceptedScope,
    CorrelationId CorrelationId,
    ActorAddress ReplyTo,
    string? ProposedIntent = null,
    string? ProposedReason = null)
{
    public const string MessageType = "agent.input.committed";
}
