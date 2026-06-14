namespace Aven.Resources.Llm;

public sealed record InMemoryLlmResponsePlan(
    InMemoryLlmScenarioKind Scenario,
    string? Text = null,
    string? StructuredJson = null,
    int PromptTokens = 10,
    int CompletionTokens = 5,
    decimal Cost = 0.01m,
    bool RecoverableAfterRestart = false);