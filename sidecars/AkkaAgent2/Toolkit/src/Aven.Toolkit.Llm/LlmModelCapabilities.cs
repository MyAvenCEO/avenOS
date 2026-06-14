namespace Aven.Toolkit.Llm;

public sealed record LlmModelCapabilities(
    string ModelName,
    bool SupportsImages,
    bool SupportsPdfArtifacts,
    bool SupportsProviderFiles,
    bool SupportsStrictStructuredOutput,
    bool SupportsToolCalls,
    bool SupportsRecoveryPolling);
