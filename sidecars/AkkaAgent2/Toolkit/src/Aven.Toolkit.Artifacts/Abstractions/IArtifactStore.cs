namespace Aven.Toolkit.Artifacts.Abstractions;

public interface IArtifactStore
{
    Task<ArtifactRef> CreateArtifactAsync(
        string filename,
        string mimeType,
        string sourceKind,
        BlobRef blob,
        string? description,
        CancellationToken cancellationToken,
        ArtifactId? artifactId = null);

    Task<ArtifactRef> AppendRevisionAsync(
        ArtifactId artifactId,
        BlobRef blob,
        string? description,
        CancellationToken cancellationToken);

    Task<ArtifactDescriptor?> GetArtifactAsync(
        ArtifactId artifactId,
        CancellationToken cancellationToken);

    Task<ArtifactRevisionDescriptor?> GetRevisionAsync(
        ArtifactRef artifactRef,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ArtifactDescriptor>> QueryArtifactsAsync(
        ArtifactQuery query,
        CancellationToken cancellationToken);
}