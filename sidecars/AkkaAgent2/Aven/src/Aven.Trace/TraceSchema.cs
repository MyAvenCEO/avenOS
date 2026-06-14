using Microsoft.Data.Sqlite;

namespace Aven.Trace;

public static class TraceSchema
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

            create table if not exists trace_events(
              event_id text not null primary key,
              event_type text not null,
              event_version integer not null,
              actor_address text not null,
              actor_kind text not null,
              command_id text null,
              delivery_id text null,
              operation_key text null,
              correlation_id text not null,
              causation_id text null,
              payload_hash text not null,
              occurred_at text not null,
              summary text not null,
              details_json text not null,
              details_truncated integer not null
            );
            create table if not exists trace_entities(
              entity_type text not null,
              entity_id text not null,
              status text not null,
              summary text not null,
              last_event_id text null,
              last_changed_at text not null,
              details_json text not null,
              primary key(entity_type, entity_id)
            );
            create table if not exists trace_links(
              from_entity_type text not null,
              from_entity_id text not null,
              to_entity_type text not null,
              to_entity_id text not null,
              link_type text not null,
              event_id text not null,
              created_at text not null,
              primary key(from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type, event_id)
            );
            create table if not exists trace_invariants(
              invariant_id text not null primary key,
              severity text not null,
              status text not null,
              entity_type text not null,
              entity_id text not null,
              message text not null,
              first_seen_at text not null,
              last_seen_at text not null,
              details_json text not null
            );
            create table if not exists trace_projection_checkpoint(
              checkpoint_id text not null primary key,
              value text not null,
              updated_at text not null
            );
            create unique index if not exists ux_trace_events_event_id on trace_events(event_id);
            create index if not exists ix_trace_events_correlation_time on trace_events(correlation_id, occurred_at);
            create index if not exists ix_trace_events_actor_time on trace_events(actor_address, occurred_at);
            create index if not exists ix_trace_events_delivery on trace_events(delivery_id, occurred_at);
            create index if not exists ix_trace_events_operation on trace_events(operation_key, occurred_at);
            create unique index if not exists ux_trace_entities on trace_entities(entity_type, entity_id);
            create index if not exists ix_trace_links_from on trace_links(from_entity_type, from_entity_id);
            create index if not exists ix_trace_links_to on trace_links(to_entity_type, to_entity_id);
            """;
        command.ExecuteNonQuery();
    }
}