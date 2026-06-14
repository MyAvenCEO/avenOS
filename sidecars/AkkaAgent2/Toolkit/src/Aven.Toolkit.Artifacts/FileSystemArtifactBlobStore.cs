using System.Security.Cryptography;

namespace Aven.Toolkit.Artifacts;

public sealed class FileSystemArtifactBlobStore : IArtifactBlobStore
{
    private readonly string _rootPath;

    public FileSystemArtifactBlobStore(string rootPath)
    {
        if (string.IsNullOrWhiteSpace(rootPath))
        {
            throw new ArgumentException("Artifact blob root path is required.", nameof(rootPath));
        }

        _rootPath = Path.GetFullPath(rootPath);
        Directory.CreateDirectory(_rootPath);
    }

    public async Task<BlobRef> PutAsync(
        string mimeType,
        ReadOnlyMemory<byte> bytes,
        CancellationToken cancellationToken = default)
    {
        _ = string.IsNullOrWhiteSpace(mimeType) ? "application/octet-stream" : mimeType;
        var contentHash = Convert.ToHexString(SHA256.HashData(bytes.Span)).ToLowerInvariant();
        var blob = new BlobRef(BlobStorageLayout.Algorithm, contentHash, bytes.Length);
        var finalPath = BlobStorageLayout.GetBlobPath(_rootPath, blob);
        var directory = Path.GetDirectoryName(finalPath)
            ?? throw new InvalidOperationException("Blob directory could not be resolved.");

        Directory.CreateDirectory(directory);
        if (!File.Exists(finalPath))
        {
            var tempPath = Path.Combine(_rootPath, $".{Guid.NewGuid():N}.tmp");
            await using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                await stream.WriteAsync(bytes, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }

            try
            {
                File.Move(tempPath, finalPath);
            }
            catch (IOException) when (File.Exists(finalPath))
            {
                if (File.Exists(tempPath))
                {
                    File.Delete(tempPath);
                }
            }
        }

        return blob;
    }

    public async Task<byte[]> GetAsync(BlobRef blob, CancellationToken cancellationToken = default)
    {
        BlobStorageLayout.Validate(blob);
        var path = BlobStorageLayout.GetBlobPath(_rootPath, blob);
        if (!File.Exists(path))
        {
            throw new InvalidOperationException($"Artifact blob '{blob.Algorithm}:{blob.Hash}' does not exist.");
        }

        return await File.ReadAllBytesAsync(path, cancellationToken);
    }
}