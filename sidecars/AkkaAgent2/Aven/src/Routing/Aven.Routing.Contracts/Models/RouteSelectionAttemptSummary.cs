namespace Aven.Routing.Contracts.Models;

public sealed record RouteSelectionAttemptSummary(
    int AttemptNumber,
    string PromptSummary,
    string? ModelOutputJson,
    bool SchemaValidated,
    string? Decision,
    RoleAgentId[] CandidateRoleAgentIds,
    string? ClarificationQuestion,
    string? ErrorCode,
    string? ErrorMessage);
