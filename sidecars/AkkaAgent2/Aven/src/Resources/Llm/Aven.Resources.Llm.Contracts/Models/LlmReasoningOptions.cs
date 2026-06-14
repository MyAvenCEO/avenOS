namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmReasoningOptions(bool EnableReasoningSummary = false, string? ThinkingBudget = null);
