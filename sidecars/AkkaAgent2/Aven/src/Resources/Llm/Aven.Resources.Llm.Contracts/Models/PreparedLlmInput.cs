namespace Aven.Resources.Llm.Contracts.Models;

public sealed record PreparedLlmInput(
    IReadOnlyList<LlmInputBlock> Input,
    IReadOnlyList<ProviderFileDescriptor> ProviderFiles,
    IReadOnlyList<LlmProviderDegradation> Degradations,
    ArtifactSourceDescriptor SourceArtifact,
    string TransportSummary);
