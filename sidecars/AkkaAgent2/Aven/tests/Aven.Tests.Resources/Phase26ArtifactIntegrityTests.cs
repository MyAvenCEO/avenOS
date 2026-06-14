using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Aven.Resources.Artifacts;
using ToolkitBlobRef = Aven.Toolkit.Artifacts.BlobRef;
using ToolkitFileSystemArtifactBlobStore = Aven.Toolkit.Artifacts.FileSystemArtifactBlobStore;

namespace Aven.Tests.Resources;

public sealed class Phase26ArtifactIntegrityTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"aven-phase26-{Guid.NewGuid():N}");
    private readonly string _sqlitePath;
    private readonly string _blobRoot;

    public Phase26ArtifactIntegrityTests()
    {
        Directory.CreateDirectory(_root);
        _sqlitePath = Path.Combine(_root, "artifacts.sqlite");
        _blobRoot = Path.Combine(_root, "blobs");
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_HealthyStoreReportsNoIssues()
    {
        var blobStore = CreateBlobStore();
        var artifactStore = CreateArtifactStore();
        var checker = CreateChecker();

        var bytes = Encoding.UTF8.GetBytes("healthy artifact bytes");
        var blob = await blobStore.PutAsync("text/plain", bytes);
        _ = await artifactStore.CreateArtifactAsync("healthy.txt", "text/plain", "upload", blob, null, CancellationToken.None);

        var report = await checker.CheckAsync(verifyBytes: true);

        Assert.True(report.Healthy);
        Assert.True(report.VerifyBytes);
        Assert.Equal(1, report.ArtifactCount);
        Assert.Equal(1, report.RevisionCount);
        Assert.Equal(1, report.ReferencedBlobCount);
        Assert.Equal(1, report.BlobRowCount);
        Assert.Equal(1, report.BlobFileCount);
        Assert.Empty(report.Issues);
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsMissingBlobFile()
    {
        var blobStore = CreateBlobStore();
        var artifactStore = CreateArtifactStore();
        var checker = CreateChecker();

        var blob = await blobStore.PutAsync("text/plain", Encoding.UTF8.GetBytes("missing file"));
        _ = await artifactStore.CreateArtifactAsync("missing.txt", "text/plain", "upload", blob, null, CancellationToken.None);

        File.Delete(GetBlobPath(blob));

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Contains(report.Issues, static issue => issue.Code == "blob_file_missing");
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsCorruptBlobContent_WhenVerifyBytes()
    {
        var blobStore = CreateBlobStore();
        var artifactStore = CreateArtifactStore();
        var checker = CreateChecker();

        var blob = await blobStore.PutAsync("text/plain", Encoding.UTF8.GetBytes("original content"));
        _ = await artifactStore.CreateArtifactAsync("corrupt.txt", "text/plain", "upload", blob, null, CancellationToken.None);

        await File.WriteAllBytesAsync(GetBlobPath(blob), Encoding.UTF8.GetBytes("changed and longer content"));

        var report = await checker.CheckAsync(verifyBytes: true);

        Assert.Contains(report.Issues, static issue => issue.Code == "blob_hash_mismatch");
        Assert.Contains(report.Issues, static issue => issue.Code == "blob_size_mismatch");
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsOrphanBlobFile()
    {
        var checker = CreateChecker();
        var orphanHash = new string('a', 64);
        var orphanBytes = Encoding.UTF8.GetBytes("orphan file");
        var orphanPath = Path.Combine(_blobRoot, "sha256", "aa", "aa", orphanHash);
        Directory.CreateDirectory(Path.GetDirectoryName(orphanPath)!);
        await File.WriteAllBytesAsync(orphanPath, orphanBytes);

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Contains(report.Issues, issue =>
            issue.Code == "blob_file_orphaned"
            && issue.Blob?.Hash == orphanHash
            && issue.Blob.SizeBytes == orphanBytes.Length);
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsOrphanBlobRow()
    {
        var checker = CreateChecker();
        var blob = new BlobRef("sha256", Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("orphan row"))).ToLowerInvariant(), Encoding.UTF8.GetByteCount("orphan row"));

        await using (var connection = OpenConnection())
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "insert into artifact_blobs(algorithm, hash, size_bytes, mime_type, storage_ref, created_at) values (@algorithm, @hash, @size, @mimeType, @storageRef, @createdAt);";
            command.Parameters.AddWithValue("@algorithm", blob.Algorithm);
            command.Parameters.AddWithValue("@hash", blob.Hash);
            command.Parameters.AddWithValue("@size", blob.SizeBytes);
            command.Parameters.AddWithValue("@mimeType", "text/plain");
            command.Parameters.AddWithValue("@storageRef", $"sha256/{blob.Hash[..2]}/{blob.Hash[2..4]}/{blob.Hash}");
            command.Parameters.AddWithValue("@createdAt", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Contains(report.Issues, issue => issue.Code == "blob_row_orphaned" && issue.Blob?.Hash == blob.Hash);
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsCurrentRevisionMissing()
    {
        var blobStore = CreateBlobStore();
        var artifactStore = CreateArtifactStore();
        var checker = CreateChecker();

        var blob = await blobStore.PutAsync("text/plain", Encoding.UTF8.GetBytes("current revision test"));
        var artifact = await artifactStore.CreateArtifactAsync("current.txt", "text/plain", "upload", blob, null, CancellationToken.None);

        await using (var connection = OpenConnection())
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "update artifacts set current_revision_id = @revisionId where artifact_id = @artifactId;";
            command.Parameters.AddWithValue("@revisionId", "revision-missing");
            command.Parameters.AddWithValue("@artifactId", artifact.ArtifactId.Value);
            await command.ExecuteNonQueryAsync();
        }

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Contains(report.Issues, issue => issue.Code == "artifact_current_revision_missing" && issue.ArtifactId?.Value == artifact.ArtifactId.Value);
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsRevisionBlobRowMissing()
    {
        var blobStore = CreateBlobStore();
        var artifactStore = CreateArtifactStore();
        var checker = CreateChecker();

        var blob = await blobStore.PutAsync("text/plain", Encoding.UTF8.GetBytes("missing row test"));
        var artifact = await artifactStore.CreateArtifactAsync("row-missing.txt", "text/plain", "upload", blob, null, CancellationToken.None);

        await using (var connection = OpenConnection())
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "delete from artifact_blobs where algorithm = @algorithm and hash = @hash;";
            command.Parameters.AddWithValue("@algorithm", blob.Algorithm);
            command.Parameters.AddWithValue("@hash", blob.Hash);
            await command.ExecuteNonQueryAsync();
        }

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Contains(report.Issues, issue =>
            issue.Code == "revision_blob_row_missing"
            && issue.ArtifactId?.Value == artifact.ArtifactId.Value
            && issue.Blob?.Hash == blob.Hash);
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsRevisionWithoutArtifact()
    {
        var checker = CreateChecker();
        var blob = CreateBlobRef("revision without artifact");

        await InsertBlobRowAsync(blob);

        await using (var connection = OpenConnection())
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                insert into artifact_revisions(artifact_id, revision_id, algorithm, hash, size_bytes, description, created_at)
                values (@artifactId, @revisionId, @algorithm, @hash, @sizeBytes, @description, @createdAt);
                """;
            command.Parameters.AddWithValue("@artifactId", "artifact-missing");
            command.Parameters.AddWithValue("@revisionId", "revision-1");
            command.Parameters.AddWithValue("@algorithm", blob.Algorithm);
            command.Parameters.AddWithValue("@hash", blob.Hash);
            command.Parameters.AddWithValue("@sizeBytes", blob.SizeBytes);
            command.Parameters.AddWithValue("@description", "orphan revision");
            command.Parameters.AddWithValue("@createdAt", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Contains(report.Issues, issue =>
            issue.Code == "revision_without_artifact"
            && issue.ArtifactId?.Value == "artifact-missing");
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsBlobStorageRefMismatch()
    {
        var blobStore = CreateBlobStore();
        var artifactStore = CreateArtifactStore();
        var checker = CreateChecker();

        var blob = await blobStore.PutAsync("text/plain", Encoding.UTF8.GetBytes("storage ref mismatch"));
        _ = await artifactStore.CreateArtifactAsync("storage-ref.txt", "text/plain", "upload", blob, null, CancellationToken.None);

        await using (var connection = OpenConnection())
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "update artifact_blobs set storage_ref = @storageRef where algorithm = @algorithm and hash = @hash;";
            command.Parameters.AddWithValue("@storageRef", "sha256/ff/ff/incorrect");
            command.Parameters.AddWithValue("@algorithm", blob.Algorithm);
            command.Parameters.AddWithValue("@hash", blob.Hash);
            await command.ExecuteNonQueryAsync();
        }

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Contains(report.Issues, issue =>
            issue.Code == "blob_storage_ref_mismatch"
            && issue.Blob?.Hash == blob.Hash);
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsInvalidBlobRowWithoutThrowing()
    {
        var blobStore = CreateBlobStore();
        var artifactStore = CreateArtifactStore();
        var checker = CreateChecker();

        var validBlob = await blobStore.PutAsync("text/plain", Encoding.UTF8.GetBytes("valid artifact"));
        _ = await artifactStore.CreateArtifactAsync("valid.txt", "text/plain", "upload", validBlob, null, CancellationToken.None);

        await using (var connection = OpenConnection())
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                insert into artifact_blobs(algorithm, hash, size_bytes, mime_type, storage_ref, created_at)
                values (@algorithm, @hash, @size, @mimeType, @storageRef, @createdAt);
                """;
            command.Parameters.AddWithValue("@algorithm", "md5");
            command.Parameters.AddWithValue("@hash", "not-a-sha256");
            command.Parameters.AddWithValue("@size", -1L);
            command.Parameters.AddWithValue("@mimeType", "text/plain");
            command.Parameters.AddWithValue("@storageRef", "md5/nope/not-a-sha256");
            command.Parameters.AddWithValue("@createdAt", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.Equal(1, report.ArtifactCount);
        Assert.Contains(report.Issues, issue => issue.Code == "blob_layout_invalid" && issue.Message.Contains("md5:not-a-sha256", StringComparison.Ordinal));
        Assert.Contains(report.Issues, issue => issue.Blob?.Hash == validBlob.Hash || issue.Code == "blob_layout_invalid");
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_DetectsInvalidBlobFileLayout()
    {
        var checker = CreateChecker();
        var hash = new string('a', 64);

        await WriteBlobFileAsync(Path.Combine(_blobRoot, "md5", "aa", "aa", hash), "unsupported algorithm");
        await WriteBlobFileAsync(Path.Combine(_blobRoot, "sha256", "00", "00", hash), "wrong prefixes");
        await WriteBlobFileAsync(Path.Combine(_blobRoot, "sha256", "sh", "or", "short"), "short hash");

        var report = await checker.CheckAsync(verifyBytes: false);

        var invalidIssues = report.Issues.Where(issue => issue.Code == "blob_layout_invalid").ToArray();
        Assert.True(invalidIssues.Length >= 3);
        Assert.Contains(invalidIssues, issue => issue.Message.Contains("unsupported algorithm directory 'md5'", StringComparison.Ordinal));
        Assert.Contains(invalidIssues, issue => issue.Message.Contains("directory prefixes do not match blob hash", StringComparison.Ordinal));
        Assert.Contains(invalidIssues, issue => issue.Message.Contains("hash must contain at least four characters", StringComparison.Ordinal)
            || issue.Message.Contains("Blob hash must be 64 lowercase hexadecimal characters.", StringComparison.Ordinal)
            || issue.Message.Contains("Blob hash must be a 64-character lowercase hexadecimal SHA-256 value.", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ArtifactIntegrityChecker_IgnoresTemporaryBlobFiles()
    {
        var checker = CreateChecker();

        Directory.CreateDirectory(_blobRoot);
        await File.WriteAllBytesAsync(Path.Combine(_blobRoot, ".partial"), Encoding.UTF8.GetBytes("temp"));
        await File.WriteAllBytesAsync(Path.Combine(_blobRoot, "some.tmp"), Encoding.UTF8.GetBytes("temp"));

        var report = await checker.CheckAsync(verifyBytes: false);

        Assert.DoesNotContain(report.Issues, issue => issue.Code is "blob_layout_invalid" or "blob_file_orphaned");
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private SqliteArtifactStore CreateArtifactStore() => new($"Data Source={_sqlitePath}");

    private ToolkitFileSystemArtifactBlobStore CreateBlobStore() => new(_blobRoot);

    private ArtifactIntegrityChecker CreateChecker() => new($"Data Source={_sqlitePath}", _blobRoot);

    private SqliteConnection OpenConnection()
    {
        var store = CreateArtifactStore();
        _ = store;
        var connection = new SqliteConnection($"Data Source={_sqlitePath}");
        connection.Open();
        return connection;
    }

    private async Task InsertBlobRowAsync(ToolkitBlobRef blob)
    {
        await using var connection = OpenConnection();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            insert into artifact_blobs(algorithm, hash, size_bytes, mime_type, storage_ref, created_at)
            values (@algorithm, @hash, @size, @mimeType, @storageRef, @createdAt);
            """;
        command.Parameters.AddWithValue("@algorithm", blob.Algorithm);
        command.Parameters.AddWithValue("@hash", blob.Hash);
        command.Parameters.AddWithValue("@size", blob.SizeBytes);
        command.Parameters.AddWithValue("@mimeType", "text/plain");
        command.Parameters.AddWithValue("@storageRef", $"sha256/{blob.Hash[..2]}/{blob.Hash[2..4]}/{blob.Hash}");
        command.Parameters.AddWithValue("@createdAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    private static ToolkitBlobRef CreateBlobRef(string content)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        return new ToolkitBlobRef("sha256", Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), bytes.Length);
    }

    private static async Task WriteBlobFileAsync(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, Encoding.UTF8.GetBytes(content));
    }

    private string GetBlobPath(ToolkitBlobRef blob) => Path.Combine(_blobRoot, "sha256", blob.Hash[..2], blob.Hash[2..4], blob.Hash);
}