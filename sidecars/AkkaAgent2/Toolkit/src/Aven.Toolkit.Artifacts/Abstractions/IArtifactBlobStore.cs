namespace Aven.Toolkit.Artifacts.Abstractions;

public interface IArtifactBlobStore
{
    Task<BlobRef> PutAsync(
        string mimeType,
        ReadOnlyMemory<byte> bytes,
        CancellationToken cancellationToken = default);

    Task<byte[]> GetAsync(
        BlobRef blob,
        CancellationToken cancellationToken = default);
}