namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmProviderHealth(
    string Provider,
    bool IsConfigured,
    bool IsHealthy,
    string StatusCode,
    string Message,
    string? Model = null);
