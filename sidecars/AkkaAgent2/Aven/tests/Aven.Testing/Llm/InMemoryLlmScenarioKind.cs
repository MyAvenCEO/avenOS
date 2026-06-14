namespace Aven.Resources.Llm;

public enum InMemoryLlmScenarioKind
{
    TextSuccess,
    StructuredSuccess,
    Refusal,
    SafetyBlock,
    InFlightUnknown
}