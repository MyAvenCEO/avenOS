namespace Aven.Resources.Llm.Contracts.Events;

public sealed record ProviderFileRegisteredForArtifact(
    ProviderFileKey ProviderFileKey,
    ArtifactId ArtifactId,
    string Purpose,
    string TransportMode,
    string CacheKey) : IAvenEvent;
