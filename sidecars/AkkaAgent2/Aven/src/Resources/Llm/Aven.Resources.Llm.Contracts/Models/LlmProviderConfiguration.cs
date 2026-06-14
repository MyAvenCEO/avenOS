namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmProviderConfiguration(
    string ProviderName,
    string? BaseUrl,
    string? ApiKey,
    string? DefaultModel,
    bool Enabled,
    string? Protocol = null);
