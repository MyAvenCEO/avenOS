using System.Security.Cryptography;
using System.Text;

namespace Aven.Toolkit.Artifacts.Tests;

public sealed class FileSystemArtifactBlobStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"aven-toolkit-artifacts-{Guid.NewGuid():N}");

    [Fact]
    public void Constructor_requires_non_empty_root_path()
    {
        var error = Assert.Throws<ArgumentException>(() => new FileSystemArtifactBlobStore("  "));

        Assert.Contains("root path is required", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task BlobWrite_ReturnsSha256BlobRef()
    {
        var store = CreateStore();
        var bytes = Encoding.UTF8.GetBytes("hello artifact");

        var blob = await store.PutAsync("text/plain", bytes);

        Assert.Equal("sha256", blob.Algorithm);
        Assert.Equal(bytes.Length, blob.SizeBytes);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), blob.Hash);
    }

    [Fact]
    public async Task IdenticalBytes_ProduceSameBlobRef()
    {
        var store = CreateStore();
        var bytes = Encoding.UTF8.GetBytes("same bytes");

        var first = await store.PutAsync("text/plain", bytes);
        var second = await store.PutAsync("text/plain", bytes);

        Assert.Equal(first, second);
    }

    [Fact]
    public async Task BlobRead_AfterReopen_ReturnsOriginalBytes()
    {
        var bytes = Encoding.UTF8.GetBytes("reopen me");
        var blob = await CreateStore().PutAsync("text/plain", bytes);

        var loaded = await CreateStore().GetAsync(blob);

        Assert.Equal(bytes, loaded);
    }

    [Fact]
    public async Task MissingBlob_Throws_WithoutTreatingMetadataAsProof()
    {
        var store = CreateStore();
        var missing = new BlobRef("sha256", new string('a', 64), 5);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => store.GetAsync(missing));

        Assert.Contains("does not exist", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Concurrent_identical_writes_share_the_final_blob_without_leaking_temp_files()
    {
        var store = CreateStore();
        var bytes = Encoding.UTF8.GetBytes(new string('x', 256 * 1024));

        var writes = Enumerable.Range(0, 16)
            .Select(_ => store.PutAsync("application/octet-stream", bytes))
            .ToArray();

        var blobs = await Task.WhenAll(writes);
        var expected = blobs[0];

        Assert.All(blobs, blob => Assert.Equal(expected, blob));
        Assert.Empty(Directory.EnumerateFiles(_root, "*.tmp", SearchOption.TopDirectoryOnly));
        Assert.True(File.Exists(Path.Combine(_root, "sha256", expected.Hash[..2], expected.Hash[2..4], expected.Hash)));
    }

    [Fact]
    public async Task PutAsync_cleans_up_temp_file_when_final_blob_was_created_by_another_writer()
    {
        var store = CreateStore();
        var bytes = Encoding.UTF8.GetBytes(new string('y', 8 * 1024 * 1024));
        var expectedHash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var finalPath = Path.Combine(_root, "sha256", expectedHash[..2], expectedHash[2..4], expectedHash);

        var putTask = store.PutAsync("application/octet-stream", bytes);

        string? tempPath = null;
        for (var i = 0; i < 1000 && tempPath is null; i++)
        {
            tempPath = Directory.Exists(_root)
                ? Directory.EnumerateFiles(_root, ".*.tmp", SearchOption.TopDirectoryOnly).SingleOrDefault()
                : null;

            if (tempPath is null)
            {
                await Task.Delay(5);
            }
        }

        Assert.NotNull(tempPath);

        Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);
        await File.WriteAllBytesAsync(finalPath, bytes);

        var blob = await putTask;

        Assert.Equal(expectedHash, blob.Hash);
        Assert.False(File.Exists(tempPath));
        Assert.True(File.Exists(finalPath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private FileSystemArtifactBlobStore CreateStore() => new(_root);
}