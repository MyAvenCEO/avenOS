namespace Aven.Routing.Contracts.Models;

public sealed record RouteAuditEntry(
    RoleAgentId RoleAgentId,
    string RoleName,
    WorkOfferId OfferId,
    string DecisionKind,
    string DecisionSummary);
