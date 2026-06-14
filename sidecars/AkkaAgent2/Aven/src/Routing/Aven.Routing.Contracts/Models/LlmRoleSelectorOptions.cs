namespace Aven.Routing.Contracts.Models;

public sealed record LlmRoleSelectorOptions(
    LlmModelCapabilities Model,
    int MaxRepairAttempts = 2,
    int MaxCandidateRetries = 3,
    bool AllowDeterministicFallbackWhenProviderUnavailable = true);
