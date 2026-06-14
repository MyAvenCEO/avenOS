namespace Aven.Toolkit.Llm;

public sealed record ProviderFileInputBlock(ProviderFileKey ProviderFileKey, string Purpose, string TransportMode) : LlmInputBlock(LlmBlockKind.ProviderFile);