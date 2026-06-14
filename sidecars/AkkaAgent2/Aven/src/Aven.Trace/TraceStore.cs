using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Aven.Trace;

public class TraceStore
{
    private readonly string _connectionString;
    public TraceStore(string connectionString)
    {
        _connectionString = connectionString;
        TraceSchema.Initialize(connectionString);
    }

    internal virtual async Task<TraceStoreWriteResult> WriteBatchAsync(IReadOnlyList<TraceProjectionDelta> deltas, CancellationToken cancellationToken = default)
    {
        if (deltas.Count == 0) return new TraceStoreWriteResult(0, 0, 0);
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var events = 0;
        var entities = 0;
        var links = 0;
        foreach (var delta in deltas)
        {
            events += await InsertEventAsync(connection, transaction, delta.Event, cancellationToken);
            foreach (var entity in delta.Entities)
            {
                entities += await UpsertEntityAsync(connection, transaction, entity, cancellationToken);
            }
            foreach (var link in delta.Links)
            {
                links += await InsertLinkAsync(connection, transaction, link, cancellationToken);
            }
        }
        await transaction.CommitAsync(cancellationToken);
        return new TraceStoreWriteResult(events, entities, links);
    }

    internal async Task<IReadOnlyList<TraceEventRecord>> QueryEventsAsync(string whereSql, Action<SqliteCommand> bind, TraceQueryOptions options, CancellationToken cancellationToken)
    {
        var limit = NormalizeLimit(options.Limit);
        var rows = new List<TraceEventRecord>();
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $$"""
            select event_id,event_type,event_version,actor_address,actor_kind,command_id,delivery_id,operation_key,correlation_id,causation_id,payload_hash,occurred_at,summary,details_json,details_truncated
            from trace_events
            where {{whereSql}}
            order by occurred_at asc
            limit $limitPlusOne
            """;
        bind(command);
        command.Parameters.AddWithValue("$limitPlusOne", limit + 1);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(ReadEvent(reader));
        return rows;
    }

    internal async Task<TraceEntityRecord?> GetEntityAsync(string entityType, string entityId, CancellationToken cancellationToken)
    {
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select entity_type,entity_id,status,summary,last_event_id,last_changed_at,details_json
            from trace_entities where entity_type=$type and entity_id=$id
            """;
        command.Parameters.AddWithValue("$type", entityType);
        command.Parameters.AddWithValue("$id", entityId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new TraceEntityRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), NullString(reader, 4), ParseTime(reader.GetString(5)), reader.GetString(6))
            : null;
    }

    internal async Task<IReadOnlyList<TraceLinkRecord>> GetLinksForSubjectAsync(string entityType, string entityId, int limit, CancellationToken cancellationToken)
    {
        var rows = new List<TraceLinkRecord>();
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select from_entity_type,from_entity_id,to_entity_type,to_entity_id,link_type,event_id,created_at
            from trace_links
            where (from_entity_type=$type and from_entity_id=$id) or (to_entity_type=$type and to_entity_id=$id)
            order by created_at asc
            limit $limit
            """;
        command.Parameters.AddWithValue("$type", entityType);
        command.Parameters.AddWithValue("$id", entityId);
        command.Parameters.AddWithValue("$limit", NormalizeLimit(limit));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(ReadLink(reader));
        return rows;
    }

    internal async Task<IReadOnlyList<TraceEntityRecord>> QueryEntitiesAsync(string entityType, string statusNotInSql, DateTimeOffset olderThan, int limit, CancellationToken cancellationToken)
    {
        var rows = new List<TraceEntityRecord>();
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $$"""
            select entity_type,entity_id,status,summary,last_event_id,last_changed_at,details_json
            from trace_entities
            where entity_type=$type and {{statusNotInSql}} and last_changed_at < $olderThan
            order by last_changed_at asc
            limit $limit
            """;
        command.Parameters.AddWithValue("$type", entityType);
        command.Parameters.AddWithValue("$olderThan", FormatTime(olderThan));
        command.Parameters.AddWithValue("$limit", NormalizeLimit(limit));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(new TraceEntityRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), NullString(reader, 4), ParseTime(reader.GetString(5)), reader.GetString(6)));
        return rows;
    }

    public async Task<bool> CanConnectAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = new SqliteConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            return true;
        }
        catch { return false; }
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "pragma busy_timeout = 5000; pragma foreign_keys = on;";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<int> InsertEventAsync(SqliteConnection connection, System.Data.Common.DbTransaction transaction, TraceEventRecord e, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = (SqliteTransaction)transaction;
        command.CommandText = """
            insert or ignore into trace_events(event_id,event_type,event_version,actor_address,actor_kind,command_id,delivery_id,operation_key,correlation_id,causation_id,payload_hash,occurred_at,summary,details_json,details_truncated)
            values($event_id,$event_type,$event_version,$actor_address,$actor_kind,$command_id,$delivery_id,$operation_key,$correlation_id,$causation_id,$payload_hash,$occurred_at,$summary,$details_json,$details_truncated)
            """;
        Bind(command, "$event_id", e.EventId); Bind(command, "$event_type", e.EventType); Bind(command, "$event_version", e.EventVersion);
        Bind(command, "$actor_address", e.ActorAddress); Bind(command, "$actor_kind", e.ActorKind); Bind(command, "$command_id", e.CommandId);
        Bind(command, "$delivery_id", e.DeliveryId); Bind(command, "$operation_key", e.OperationKey); Bind(command, "$correlation_id", e.CorrelationId);
        Bind(command, "$causation_id", e.CausationId); Bind(command, "$payload_hash", e.PayloadHash); Bind(command, "$occurred_at", FormatTime(e.OccurredAt));
        Bind(command, "$summary", e.Summary); Bind(command, "$details_json", e.DetailsJson); Bind(command, "$details_truncated", e.DetailsTruncated ? 1 : 0);
        return await command.ExecuteNonQueryAsync(ct);
    }

    private static async Task<int> UpsertEntityAsync(SqliteConnection connection, System.Data.Common.DbTransaction transaction, TraceEntityRecord e, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = (SqliteTransaction)transaction;
        command.CommandText = """
            insert into trace_entities(entity_type,entity_id,status,summary,last_event_id,last_changed_at,details_json)
            values($type,$id,$status,$summary,$last_event_id,$last_changed_at,$details_json)
            on conflict(entity_type,entity_id) do update set
              status=excluded.status, summary=excluded.summary, last_event_id=excluded.last_event_id,
              last_changed_at=excluded.last_changed_at, details_json=excluded.details_json
            where excluded.last_changed_at >= trace_entities.last_changed_at
            """;
        Bind(command, "$type", e.EntityType); Bind(command, "$id", e.EntityId); Bind(command, "$status", e.Status);
        Bind(command, "$summary", e.Summary); Bind(command, "$last_event_id", e.LastEventId); Bind(command, "$last_changed_at", FormatTime(e.LastChangedAt));
        Bind(command, "$details_json", e.DetailsJson);
        return await command.ExecuteNonQueryAsync(ct);
    }

    private static async Task<int> InsertLinkAsync(SqliteConnection connection, System.Data.Common.DbTransaction transaction, TraceLinkRecord l, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = (SqliteTransaction)transaction;
        command.CommandText = """
            insert or ignore into trace_links(from_entity_type,from_entity_id,to_entity_type,to_entity_id,link_type,event_id,created_at)
            values($from_type,$from_id,$to_type,$to_id,$link_type,$event_id,$created_at)
            """;
        Bind(command, "$from_type", l.FromEntityType); Bind(command, "$from_id", l.FromEntityId); Bind(command, "$to_type", l.ToEntityType);
        Bind(command, "$to_id", l.ToEntityId); Bind(command, "$link_type", l.LinkType); Bind(command, "$event_id", l.EventId); Bind(command, "$created_at", FormatTime(l.CreatedAt));
        return await command.ExecuteNonQueryAsync(ct);
    }

    private static TraceEventRecord ReadEvent(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetInt32(2), r.GetString(3), r.GetString(4), NullString(r, 5), NullString(r, 6), NullString(r, 7), r.GetString(8), NullString(r, 9), r.GetString(10), ParseTime(r.GetString(11)), r.GetString(12), r.GetString(13), r.GetInt32(14) != 0);
    private static TraceLinkRecord ReadLink(SqliteDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetString(5), ParseTime(r.GetString(6)));
    internal static DateTimeOffset ParseTime(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
    internal static string FormatTime(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    internal static int NormalizeLimit(int limit) => Math.Clamp(limit <= 0 ? 200 : limit, 1, 1000);
    internal static JsonNode? ParseDetails(string json) { try { return JsonNode.Parse(json); } catch { return null; } }
    private static string? NullString(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    private static void Bind(SqliteCommand command, string name, object? value) => command.Parameters.AddWithValue(name, value ?? DBNull.Value);
}