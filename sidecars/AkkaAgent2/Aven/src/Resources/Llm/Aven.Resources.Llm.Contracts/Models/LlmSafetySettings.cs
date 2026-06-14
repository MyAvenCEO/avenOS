namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmSafetySettings(bool AllowPromptOnlyFallback = true, bool BlockUnsafeContent = true);
