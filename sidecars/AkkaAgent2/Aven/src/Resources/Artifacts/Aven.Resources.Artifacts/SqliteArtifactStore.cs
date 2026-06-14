using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Aven.Resources.Artifacts;

public sealed class SqliteArtifactStore : IArtifactStore
{
    private const int DefaultLimit = 50;
    private const int MaxLimit = 200;
    private readonly string _connectionString;

    public SqliteArtifactStore(string connectionString)
    {
        _connectionString = string.IsNullOrWhiteSpace(connectionString)
            ? throw new ArgumentException("Artifact store connection string is required.", nameof(connectionString))
            : connectionString;

        ArtifactStoreSchema.Initialize(_connectionString);
    }

    public async Task<ArtifactRef> CreateArtifactAsync(
        string filename,
        string mimeType,
        string sourceKind,
        BlobRef blob,
        string? description,
        CancellationToken cancellationToken,
        ArtifactId? artifactId = null)
    {
        ValidateBlob(blob);
        ValidateText(filename, nameof(filename));
        ValidateText(mimeType, nameof(mimeType));
        ValidateText(sourceKind, nameof(sourceKind));

        var effectiveArtifactId = artifactId ?? new ArtifactId($"artifact-{Guid.NewGuid():N}");
        var revisionId = NewRevisionId();
        var now = DateTimeOffset.UtcNow;

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        await UpsertBlobAsync(connection, transaction, blob, mimeType, now, cancellationToken);
        await InsertArtifactAsync(connection, transaction, effectiveArtifactId, revisionId, filename, mimeType, sourceKind, now, cancellationToken);
        await InsertRevisionAsync(connection, transaction, effectiveArtifactId, revisionId, blob, description, now, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new ArtifactRef(effectiveArtifactId, revisionId);
    }

    public async Task<ArtifactRef> AppendRevisionAsync(
        ArtifactId artifactId,
        BlobRef blob,
        string? description,
        CancellationToken cancellationToken)
    {
        ValidateText(artifactId.Value, nameof(artifactId));
        ValidateBlob(blob);

        var revisionId = NewRevisionId();
        var now = DateTimeOffset.UtcNow;

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var artifactRow = await GetArtifactRowAsync(connection, transaction, artifactId, cancellationToken)
            ?? throw new InvalidOperationException($"Artifact '{artifactId.Value}' was not found.");

        await UpsertBlobAsync(connection, transaction, blob, artifactRow.MimeType, now, cancellationToken);
        await InsertRevisionAsync(connection, transaction, artifactId, revisionId, blob, description, now, cancellationToken);
        await UpdateCurrentRevisionAsync(connection, transaction, artifactId, revisionId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new ArtifactRef(artifactId, revisionId);
    }

    public async Task<ArtifactDescriptor?> GetArtifactAsync(ArtifactId artifactId, CancellationToken cancellationToken)
    {
        ValidateText(artifactId.Value, nameof(artifactId));

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);

        var artifactRow = await GetArtifactRowAsync(connection, null, artifactId, cancellationToken);
        if (artifactRow is null)
        {
            return null;
        }

        var revisions = await GetRevisionRowsAsync(connection, null, artifactId, cancellationToken);
        return ToDescriptor(artifactRow, revisions);
    }

    public async Task<ArtifactRevisionDescriptor?> GetRevisionAsync(ArtifactRef artifactRef, CancellationToken cancellationToken)
    {
        ValidateText(artifactRef.ArtifactId.Value, nameof(artifactRef));

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);

        var artifactRow = await GetArtifactRowAsync(connection, null, artifactRef.ArtifactId, cancellationToken);
        if (artifactRow is null)
        {
            return null;
        }

        var revisionId = artifactRef.RevisionId ?? artifactRow.CurrentRevisionId;
        var revision = await GetRevisionRowAsync(connection, null, artifactRef.ArtifactId, revisionId, cancellationToken);
        return revision is null ? null : ToRevisionDescriptor(revision);
    }

    public async Task<IReadOnlyList<ArtifactDescriptor>> QueryArtifactsAsync(ArtifactQuery query, CancellationToken cancellationToken)
    {
        query ??= new ArtifactQuery(null, null, null, null);
        var limit = Math.Clamp(query.Limit ?? DefaultLimit, 1, MaxLimit);

        var rows = new List<ArtifactRow>();

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                select artifact_id, filename, mime_type, source_kind, current_revision_id, created_at
                from artifacts
                where (@filenameContains is null or filename like '%' || @filenameContains || '%' collate nocase)
                  and (@mimeType is null or mime_type = @mimeType)
                  and (@sourceKind is null or source_kind = @sourceKind)
                order by created_at desc
                limit @limit;
                """;
            command.Parameters.AddWithValue("@filenameContains", (object?)query.FilenameContains ?? DBNull.Value);
            command.Parameters.AddWithValue("@mimeType", (object?)query.MimeType ?? DBNull.Value);
            command.Parameters.AddWithValue("@sourceKind", (object?)query.SourceKind ?? DBNull.Value);
            command.Parameters.AddWithValue("@limit", limit);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(ReadArtifactRow(reader));
            }
        }

        var descriptors = new List<ArtifactDescriptor>(rows.Count);
        foreach (var row in rows)
        {
            var revisions = await GetRevisionRowsAsync(connection, null, row.ArtifactId, cancellationToken);
            descriptors.Add(ToDescriptor(row, revisions));
        }

        return descriptors;
    }

    private static async Task InsertArtifactAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ArtifactId artifactId,
        ArtifactRevisionId currentRevisionId,
        string filename,
        string mimeType,
        string sourceKind,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert into artifacts(artifact_id, filename, mime_type, source_kind, current_revision_id, created_at)
            values (@artifactId, @filename, @mimeType, @sourceKind, @currentRevisionId, @createdAt);
            """;
        command.Parameters.AddWithValue("@artifactId", artifactId.Value);
        command.Parameters.AddWithValue("@filename", filename);
        command.Parameters.AddWithValue("@mimeType", mimeType);
        command.Parameters.AddWithValue("@sourceKind", sourceKind);
        command.Parameters.AddWithValue("@currentRevisionId", currentRevisionId.Value);
        command.Parameters.AddWithValue("@createdAt", createdAt.ToString("O", CultureInfo.InvariantCulture));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertRevisionAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ArtifactId artifactId,
        ArtifactRevisionId revisionId,
        BlobRef blob,
        string? description,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert into artifact_revisions(artifact_id, revision_id, algorithm, hash, size_bytes, description, created_at)
            values (@artifactId, @revisionId, @algorithm, @hash, @sizeBytes, @description, @createdAt);
            """;
        command.Parameters.AddWithValue("@artifactId", artifactId.Value);
        command.Parameters.AddWithValue("@revisionId", revisionId.Value);
        command.Parameters.AddWithValue("@algorithm", blob.Algorithm);
        command.Parameters.AddWithValue("@hash", blob.Hash);
        command.Parameters.AddWithValue("@sizeBytes", blob.SizeBytes);
        command.Parameters.AddWithValue("@description", (object?)description ?? DBNull.Value);
        command.Parameters.AddWithValue("@createdAt", createdAt.ToString("O", CultureInfo.InvariantCulture));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task UpdateCurrentRevisionAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ArtifactId artifactId,
        ArtifactRevisionId currentRevisionId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "update artifacts set current_revision_id = @currentRevisionId where artifact_id = @artifactId;";
        command.Parameters.AddWithValue("@artifactId", artifactId.Value);
        command.Parameters.AddWithValue("@currentRevisionId", currentRevisionId.Value);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
        {
            throw new InvalidOperationException($"Artifact '{artifactId.Value}' was not found.");
        }
    }

    private static async Task UpsertBlobAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        BlobRef blob,
        string mimeType,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert into artifact_blobs(algorithm, hash, size_bytes, mime_type, storage_ref, created_at)
            values (@algorithm, @hash, @sizeBytes, @mimeType, @storageRef, @createdAt)
            on conflict(algorithm, hash) do nothing;
            """;
        command.Parameters.AddWithValue("@algorithm", blob.Algorithm);
        command.Parameters.AddWithValue("@hash", blob.Hash);
        command.Parameters.AddWithValue("@sizeBytes", blob.SizeBytes);
        command.Parameters.AddWithValue("@mimeType", mimeType);
        command.Parameters.AddWithValue("@storageRef", BlobStorageLayout.GetStorageRef(blob));
        command.Parameters.AddWithValue("@createdAt", createdAt.ToString("O", CultureInfo.InvariantCulture));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<ArtifactRow?> GetArtifactRowAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        ArtifactId artifactId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "select artifact_id, filename, mime_type, source_kind, current_revision_id, created_at from artifacts where artifact_id = @artifactId limit 1;";
        command.Parameters.AddWithValue("@artifactId", artifactId.Value);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadArtifactRow(reader) : null;
    }

    private static async Task<List<ArtifactRevisionRow>> GetRevisionRowsAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        ArtifactId artifactId,
        CancellationToken cancellationToken)
    {
        var rows = new List<ArtifactRevisionRow>();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            select artifact_id, revision_id, algorithm, hash, size_bytes, description, created_at
            from artifact_revisions
            where artifact_id = @artifactId
            order by created_at asc;
            """;
        command.Parameters.AddWithValue("@artifactId", artifactId.Value);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(ReadRevisionRow(reader));
        }

        return rows;
    }

    private static async Task<ArtifactRevisionRow?> GetRevisionRowAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        ArtifactId artifactId,
        ArtifactRevisionId revisionId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            select artifact_id, revision_id, algorithm, hash, size_bytes, description, created_at
            from artifact_revisions
            where artifact_id = @artifactId and revision_id = @revisionId
            limit 1;
            """;
        command.Parameters.AddWithValue("@artifactId", artifactId.Value);
        command.Parameters.AddWithValue("@revisionId", revisionId.Value);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadRevisionRow(reader) : null;
    }

    private static ArtifactDescriptor ToDescriptor(ArtifactRow artifact, IReadOnlyList<ArtifactRevisionRow> revisions)
    {
        var currentRevision = revisions.FirstOrDefault(row => row.RevisionId == artifact.CurrentRevisionId);
        var orderedRevisions = revisions
            .Where(row => row.RevisionId != artifact.CurrentRevisionId)
            .OrderBy(static row => row.CreatedAt)
            .Select(ToRevisionDescriptor)
            .ToList();

        if (currentRevision is not null)
        {
            orderedRevisions.Add(ToRevisionDescriptor(currentRevision));
        }

        return new ArtifactDescriptor(
            artifact.ArtifactId,
            artifact.CurrentRevisionId,
            artifact.Filename,
            artifact.MimeType,
            artifact.SourceKind,
            artifact.CreatedAt,
            orderedRevisions.ToArray());
    }

    private static ArtifactRevisionDescriptor ToRevisionDescriptor(ArtifactRevisionRow revision) =>
        new(
            revision.RevisionId,
            new BlobRef(revision.Algorithm, revision.Hash, revision.SizeBytes),
            revision.CreatedAt,
            revision.Description);

    private static ArtifactRow ReadArtifactRow(SqliteDataReader reader) =>
        new(
            new ArtifactId(reader.GetString(0)),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            new ArtifactRevisionId(reader.GetString(4)),
            DateTimeOffset.Parse(reader.GetString(5), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));

    private static ArtifactRevisionRow ReadRevisionRow(SqliteDataReader reader) =>
        new(
            new ArtifactId(reader.GetString(0)),
            new ArtifactRevisionId(reader.GetString(1)),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetInt64(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            DateTimeOffset.Parse(reader.GetString(6), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));

    private static ArtifactRevisionId NewRevisionId() => new($"revision-{Guid.NewGuid():N}");

    private static void ValidateBlob(BlobRef blob) => BlobStorageLayout.Validate(blob);

    private static void ValidateText(string value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"{parameterName} is required.", parameterName);
        }
    }

    private sealed record ArtifactRow(
        ArtifactId ArtifactId,
        string Filename,
        string MimeType,
        string SourceKind,
        ArtifactRevisionId CurrentRevisionId,
        DateTimeOffset CreatedAt);

    private sealed record ArtifactRevisionRow(
        ArtifactId ArtifactId,
        ArtifactRevisionId RevisionId,
        string Algorithm,
        string Hash,
        long SizeBytes,
        string? Description,
        DateTimeOffset CreatedAt);
}