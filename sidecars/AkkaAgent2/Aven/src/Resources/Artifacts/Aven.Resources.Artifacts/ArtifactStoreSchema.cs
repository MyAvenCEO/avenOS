using Microsoft.Data.Sqlite;

namespace Aven.Resources.Artifacts;

internal static class ArtifactStoreSchema
{
    public static void Initialize(string connectionString)
    {
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            pragma journal_mode = wal;
            pragma busy_timeout = 5000;
            pragma foreign_keys = on;

            create table if not exists artifact_blobs(
              algorithm text not null,
              hash text not null,
              size_bytes integer not null,
              mime_type text not null,
              storage_ref text not null,
              created_at text not null,
              primary key (algorithm, hash)
            );

            create table if not exists artifacts(
              artifact_id text not null primary key,
              filename text not null,
              mime_type text not null,
              source_kind text not null,
              current_revision_id text not null,
              created_at text not null
            );

            create table if not exists artifact_revisions(
              artifact_id text not null,
              revision_id text not null,
              algorithm text not null,
              hash text not null,
              size_bytes integer not null,
              description text null,
              created_at text not null,
              primary key (artifact_id, revision_id)
            );

            create index if not exists ix_artifacts_filename on artifacts(filename);
            create index if not exists ix_artifacts_mime_type on artifacts(mime_type);
            create index if not exists ix_artifacts_source_kind on artifacts(source_kind);
            create index if not exists ix_artifact_revisions_artifact_id on artifact_revisions(artifact_id);
            """;
        command.ExecuteNonQuery();
    }
}