namespace Aven.Toolkit.Llm;

public sealed record LlmUsage(int PromptTokens, int CompletionTokens, int TotalTokens, decimal Cost);