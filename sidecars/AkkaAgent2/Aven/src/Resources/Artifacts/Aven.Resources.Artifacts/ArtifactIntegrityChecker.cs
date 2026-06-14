using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

namespace Aven.Resources.Artifacts;

public sealed class ArtifactIntegrityChecker
{
    private readonly string _connectionString;
    private readonly string _blobRootPath;

    public ArtifactIntegrityChecker(string connectionString, string blobRootPath)
    {
        _connectionString = string.IsNullOrWhiteSpace(connectionString)
            ? throw new ArgumentException("Artifact store connection string is required.", nameof(connectionString))
            : connectionString;
        _blobRootPath = string.IsNullOrWhiteSpace(blobRootPath)
            ? throw new ArgumentException("Artifact blob root path is required.", nameof(blobRootPath))
            : Path.GetFullPath(blobRootPath);
    }

    public async Task<ArtifactIntegrityReport> CheckAsync(bool verifyBytes, CancellationToken cancellationToken = default)
    {
        var issues = new List<ArtifactIntegrityIssue>();

        ArtifactStoreSchema.Initialize(_connectionString);
        Directory.CreateDirectory(_blobRootPath);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);

        var artifacts = await LoadArtifactsAsync(connection, cancellationToken);
        var revisions = await LoadRevisionsAsync(connection, cancellationToken);
        var blobRows = await LoadBlobRowsAsync(connection, cancellationToken);

        var artifactById = artifacts.ToDictionary(static x => x.ArtifactId, StringComparer.Ordinal);
        var revisionByKey = revisions.ToDictionary(static x => (x.ArtifactId, x.RevisionId));
        var blobRowByKey = blobRows.ToDictionary(static x => (x.Algorithm, x.Hash));
        var referencedBlobKeys = revisions
            .Select(static x => (x.Algorithm, x.Hash))
            .Distinct()
            .ToHashSet();

        foreach (var artifact in artifacts)
        {
            if (!revisionByKey.TryGetValue((artifact.ArtifactId, artifact.CurrentRevisionId), out _))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "artifact_current_revision_missing",
                    "error",
                    new ArtifactId(artifact.ArtifactId),
                    new ArtifactRevisionId(artifact.CurrentRevisionId),
                    null,
                    $"Artifact '{artifact.ArtifactId}' references missing current revision '{artifact.CurrentRevisionId}'."));
            }
        }

        foreach (var revision in revisions)
        {
            BlobRef? blob = TryCreateBlobRef(revision.Algorithm, revision.Hash, revision.SizeBytes, issues, revision.ArtifactId, revision.RevisionId);

            if (!artifactById.ContainsKey(revision.ArtifactId))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "revision_without_artifact",
                    "error",
                    new ArtifactId(revision.ArtifactId),
                    new ArtifactRevisionId(revision.RevisionId),
                    blob,
                    $"Revision '{revision.RevisionId}' references missing artifact '{revision.ArtifactId}'."));
            }

            if (!blobRowByKey.ContainsKey((revision.Algorithm, revision.Hash)))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "revision_blob_row_missing",
                    "error",
                    new ArtifactId(revision.ArtifactId),
                    new ArtifactRevisionId(revision.RevisionId),
                    blob,
                    $"Revision '{revision.RevisionId}' references blob row '{revision.Algorithm}:{revision.Hash}' that does not exist."));
            }
        }

        foreach (var blobRow in blobRows)
        {
            BlobRef? blob = TryCreateBlobRef(blobRow.Algorithm, blobRow.Hash, blobRow.SizeBytes, issues, null, null);
            if (blob is null)
            {
                continue;
            }

            var expectedStorageRef = BlobStorageLayout.GetStorageRef(blob);
            if (!string.Equals(blobRow.StorageRef, expectedStorageRef, StringComparison.Ordinal))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "blob_storage_ref_mismatch",
                    "error",
                    null,
                    null,
                    blob,
                    $"Blob row '{blob.Algorithm}:{blob.Hash}' has storage_ref '{blobRow.StorageRef}' but expected '{expectedStorageRef}'."));
            }

            var path = BlobStorageLayout.GetBlobPath(_blobRootPath, blob);
            if (!File.Exists(path))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "blob_file_missing",
                    "error",
                    null,
                    null,
                    blob,
                    $"Blob row '{blob.Algorithm}:{blob.Hash}' is missing file '{path}'."));
            }
            else if (verifyBytes)
            {
                var fileInfo = new FileInfo(path);
                if (fileInfo.Length != blob.SizeBytes)
                {
                    issues.Add(new ArtifactIntegrityIssue(
                        "blob_size_mismatch",
                        "error",
                        null,
                        null,
                        blob,
                        $"Blob file '{path}' has size {fileInfo.Length} but expected {blob.SizeBytes}."));
                }

                var actualHash = await ComputeSha256Async(path, cancellationToken);
                if (!string.Equals(actualHash, blob.Hash, StringComparison.Ordinal))
                {
                    issues.Add(new ArtifactIntegrityIssue(
                        "blob_hash_mismatch",
                        "error",
                        null,
                        null,
                        blob,
                        $"Blob file '{path}' hash '{actualHash}' does not match expected '{blob.Hash}'."));
                }
            }

            if (!referencedBlobKeys.Contains((blob.Algorithm, blob.Hash)))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "blob_row_orphaned",
                    "error",
                    null,
                    null,
                    blob,
                    $"Blob row '{blob.Algorithm}:{blob.Hash}' is not referenced by any artifact revision."));
            }
        }

        var blobFiles = EnumerateBlobFiles(issues).ToArray();
        foreach (var blobFile in blobFiles)
        {
            if (!blobRowByKey.ContainsKey((blobFile.Blob.Algorithm, blobFile.Blob.Hash)))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "blob_file_orphaned",
                    "warning",
                    null,
                    null,
                    blobFile.Blob,
                    $"Blob file '{blobFile.Path}' does not have a matching artifact_blobs row."));
            }
        }

        return new ArtifactIntegrityReport(
            DateTimeOffset.UtcNow,
            verifyBytes,
            artifacts.Count,
            revisions.Count,
            referencedBlobKeys.Count,
            blobRows.Count,
            blobFiles.Length,
            issues.ToArray());
    }

    private IEnumerable<BlobFileEntry> EnumerateBlobFiles(List<ArtifactIntegrityIssue> issues)
    {
        if (!Directory.Exists(_blobRootPath))
        {
            yield break;
        }

        foreach (var path in Directory.EnumerateFiles(_blobRootPath, "*", SearchOption.AllDirectories))
        {
            var fileName = Path.GetFileName(path);
            if (fileName.StartsWith(".", StringComparison.Ordinal) || fileName.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var relativePath = Path.GetRelativePath(_blobRootPath, path).Replace(Path.DirectorySeparatorChar, '/');
            var sizeBytes = new FileInfo(path).Length;
            if (!TryParseBlobFromRelativePath(relativePath, sizeBytes, out var blob, out var errorMessage))
            {
                issues.Add(new ArtifactIntegrityIssue(
                    "blob_layout_invalid",
                    "error",
                    null,
                    null,
                    null,
                    $"Blob file '{relativePath}' has invalid storage layout: {errorMessage}"));
                continue;
            }

            yield return new BlobFileEntry(path, blob!);
        }
    }

    private static bool TryParseBlobFromRelativePath(string relativePath, long sizeBytes, out BlobRef? blob, out string? errorMessage)
    {
        blob = null;
        errorMessage = null;

        var segments = relativePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length != 4)
        {
            errorMessage = "expected path sha256/{hh}/{hh}/{hash}";
            return false;
        }

        if (!string.Equals(segments[0], BlobStorageLayout.Algorithm, StringComparison.Ordinal))
        {
            errorMessage = $"unsupported algorithm directory '{segments[0]}'";
            return false;
        }

        var hash = segments[3];
        if (segments[1].Length != 2 || segments[2].Length != 2)
        {
            errorMessage = "hash prefix directories must be two hexadecimal characters each";
            return false;
        }

        if (hash.Length < 4)
        {
            errorMessage = "hash must contain at least four characters";
            return false;
        }

        if (!string.Equals(segments[1], hash[..2], StringComparison.Ordinal)
            || !string.Equals(segments[2], hash[2..4], StringComparison.Ordinal))
        {
            errorMessage = "directory prefixes do not match blob hash";
            return false;
        }

        try
        {
            blob = new BlobRef(BlobStorageLayout.Algorithm, hash, sizeBytes);
            BlobStorageLayout.Validate(blob);
            return true;
        }
        catch (Exception ex)
        {
            errorMessage = ex.Message;
            blob = null;
            return false;
        }
    }

    private static BlobRef? TryCreateBlobRef(
        string algorithm,
        string hash,
        long sizeBytes,
        List<ArtifactIntegrityIssue> issues,
        string? artifactId,
        string? revisionId)
    {
        try
        {
            var blob = new BlobRef(algorithm, hash, sizeBytes);
            BlobStorageLayout.Validate(blob);
            return blob;
        }
        catch (Exception ex)
        {
            issues.Add(new ArtifactIntegrityIssue(
                "blob_layout_invalid",
                "error",
                string.IsNullOrWhiteSpace(artifactId) ? null : new ArtifactId(artifactId),
                string.IsNullOrWhiteSpace(revisionId) ? null : new ArtifactRevisionId(revisionId),
                null,
                $"Blob row '{algorithm}:{hash}' is invalid: {ex.Message}"));
            return null;
        }
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static async Task<List<ArtifactRow>> LoadArtifactsAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        var rows = new List<ArtifactRow>();
        await using var command = connection.CreateCommand();
        command.CommandText = "select artifact_id, current_revision_id from artifacts;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ArtifactRow(reader.GetString(0), reader.GetString(1)));
        }

        return rows;
    }

    private static async Task<List<RevisionRow>> LoadRevisionsAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        var rows = new List<RevisionRow>();
        await using var command = connection.CreateCommand();
        command.CommandText = "select artifact_id, revision_id, algorithm, hash, size_bytes from artifact_revisions;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new RevisionRow(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt64(4)));
        }

        return rows;
    }

    private static async Task<List<BlobRow>> LoadBlobRowsAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        var rows = new List<BlobRow>();
        await using var command = connection.CreateCommand();
        command.CommandText = "select algorithm, hash, size_bytes, storage_ref from artifact_blobs;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new BlobRow(reader.GetString(0), reader.GetString(1), reader.GetInt64(2), reader.GetString(3)));
        }

        return rows;
    }

    private sealed record ArtifactRow(string ArtifactId, string CurrentRevisionId);

    private sealed record RevisionRow(string ArtifactId, string RevisionId, string Algorithm, string Hash, long SizeBytes);

    private sealed record BlobRow(string Algorithm, string Hash, long SizeBytes, string StorageRef);

    private sealed record BlobFileEntry(string Path, BlobRef Blob);
}