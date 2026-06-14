namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmBudgetLimits(decimal? MaxCost = null, int? MaxInputTokens = null, int? MaxOutputTokens = null);
