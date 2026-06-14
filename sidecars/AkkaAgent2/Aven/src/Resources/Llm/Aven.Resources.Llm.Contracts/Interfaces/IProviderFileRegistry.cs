namespace Aven.Resources.Llm.Contracts.Interfaces;

public interface IProviderFileRegistry
{
    Task<ProviderFileDescriptor> GetOrCreateAsync(string providerName, ArtifactSourceDescriptor artifact, string purpose, string transportMode, CancellationToken cancellationToken = default);
    ProviderFileDescriptor GetOrCreate(string providerName, ArtifactSourceDescriptor artifact, string purpose, string transportMode);
}
