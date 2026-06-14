namespace Aven.Toolkit.Artifacts.Tests;

public sealed class BlobStorageLayoutTests
{
    [Fact]
    public void BlobStorageLayout_builds_storage_ref_and_blob_path()
    {
        var blob = new BlobRef("sha256", "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", 12);

        var storageRef = BlobStorageLayout.GetStorageRef(blob);
        var path = BlobStorageLayout.GetBlobPath("/tmp/artifacts", blob);

        Assert.Equal("sha256/ab/cd/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", storageRef);
        Assert.EndsWith(Path.Combine("sha256", "ab", "cd", "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"), path, StringComparison.Ordinal);
    }

    [Fact]
    public void BlobStorageLayout_rejects_unsupported_algorithm()
    {
        var blob = new BlobRef("md5", new string('a', 64), 1);

        var error = Assert.Throws<InvalidOperationException>(() => BlobStorageLayout.Validate(blob));

        Assert.Contains("Unsupported blob algorithm 'md5'", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("short")]
    [InlineData("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")]
    public void BlobStorageLayout_rejects_invalid_hashes(string hash)
    {
        var blob = new BlobRef("sha256", hash, 1);

        var error = Assert.Throws<InvalidOperationException>(() => BlobStorageLayout.Validate(blob));

        Assert.Contains("64-character lowercase hexadecimal SHA-256", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void BlobStorageLayout_rejects_negative_size()
    {
        var blob = new BlobRef("sha256", new string('a', 64), -1);

        var error = Assert.Throws<InvalidOperationException>(() => BlobStorageLayout.Validate(blob));

        Assert.Contains("non-negative", error.Message, StringComparison.Ordinal);
    }
}