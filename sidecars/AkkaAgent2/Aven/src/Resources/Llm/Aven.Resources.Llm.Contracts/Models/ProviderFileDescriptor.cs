namespace Aven.Resources.Llm.Contracts.Models;

public sealed record ProviderFileDescriptor(
    ProviderFileKey ProviderFileKey,
    ArtifactId ArtifactId,
    string Purpose,
    string TransportMode);
