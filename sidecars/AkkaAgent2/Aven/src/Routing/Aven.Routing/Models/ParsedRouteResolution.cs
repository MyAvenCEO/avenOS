namespace Aven.Routing.Models;

public sealed record ParsedRouteResolution(
    string Decision,
    IReadOnlyList<RoleAgentId> CandidateRoleAgentIds,
    string Reason,
    string? ClarificationQuestion);
