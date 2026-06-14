namespace Aven.Resources.Llm.Registries;

public sealed class InMemoryProviderFileRegistry : IProviderFileRegistry
{
    private readonly Dictionary<string, ProviderFileDescriptor> _entries = new(StringComparer.Ordinal);

    public Task<ProviderFileDescriptor> GetOrCreateAsync(string providerName, ArtifactSourceDescriptor artifact, string purpose, string transportMode, CancellationToken cancellationToken = default) =>
        Task.FromResult(GetOrCreate(providerName, artifact, purpose, transportMode));

    public ProviderFileDescriptor GetOrCreate(string providerName, ArtifactSourceDescriptor artifact, string purpose, string transportMode)
    {
        var key = BuildCacheKey(providerName, artifact.Blob, purpose, transportMode);
        if (_entries.TryGetValue(key, out var existing))
        {
            return existing;
        }

        var descriptor = new ProviderFileDescriptor(
            new ProviderFileKey($"{providerName}:{artifact.Blob.Hash}:{purpose}:{transportMode}"),
            new ArtifactId(artifact.Artifact.ArtifactId.Value),
            purpose,
            transportMode);

        _entries[key] = descriptor;
        return descriptor;
    }

    private static string BuildCacheKey(string providerName, BlobRef blob, string purpose, string transportMode) =>
        string.Join("|", providerName, blob.Algorithm, blob.Hash, blob.SizeBytes, purpose, transportMode);
}