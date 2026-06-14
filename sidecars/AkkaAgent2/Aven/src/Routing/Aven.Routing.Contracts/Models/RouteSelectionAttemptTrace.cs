namespace Aven.Routing.Contracts.Models;

public sealed record RouteSelectionAttemptTrace(
    int AttemptNumber,
    string PromptSummary,
    string? ModelOutputJson,
    bool SchemaValidated,
    string? Decision,
    IReadOnlyList<RoleAgentId> CandidateRoleAgentIds,
    string? ClarificationQuestion,
    string? ErrorCode,
    string? ErrorMessage);
