using Akka.Actor;
using Microsoft.Data.Sqlite;

namespace Aven.RoleAgents;

internal sealed class RoleAgentLedgerBackfillReader
{
    private const string DefaultJournalTableName = "event_journal";

    public async Task ReplayAsync(ActorSystem system, RoleAgentLedgerStore store, CancellationToken cancellationToken = default)
    {
        var config = system.Settings.Config;
        var journalPluginPath = config.GetString("akka.persistence.journal.plugin");
        if (string.IsNullOrWhiteSpace(journalPluginPath))
        {
            return;
        }

        var connectionStringPath = $"{journalPluginPath}.connection-string";
        if (!config.HasPath(connectionStringPath))
        {
            return;
        }

        var connectionString = config.GetString(connectionStringPath);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return;
        }

        var tableNamePath = $"{journalPluginPath}.table-name";
        var tableName = config.HasPath(tableNamePath)
            ? config.GetString(tableNamePath)
            : DefaultJournalTableName;

        var serialization = ((ExtendedActorSystem)system).Serialization;

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        if (!await TableExistsAsync(connection, tableName, cancellationToken))
        {
            return;
        }

        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            select payload, serializer_id, manifest
            from {QuoteIdentifier(tableName)}
            where is_deleted = 0
            order by ordering asc;
            """;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var payload = (byte[])reader[0];
            var serializerId = reader.GetInt32(1);
            var manifest = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);

            var deserialized = serialization.Deserialize(payload, serializerId, manifest);
            if (deserialized is IAvenEventEnvelope envelope && IsLedgerEvent(envelope.Data))
            {
                await store.ApplyAsync(envelope, cancellationToken);
            }
        }
    }

    private static async Task<bool> TableExistsAsync(SqliteConnection connection, string tableName, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "select 1 from sqlite_master where type = 'table' and name = $name limit 1;";
        command.Parameters.AddWithValue("$name", tableName);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is not null and not DBNull;
    }

    private static string QuoteIdentifier(string identifier) => $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static bool IsLedgerEvent(IAvenEvent e) => e is
        WorkItemOpened or
        RunStarted or
        RunProgressed or
        OperationRequested or
        OperationCompleted or
        Aven.RoleAgents.Contracts.Ledger.OperationFailed or
        RunCompleted or
        RunBlocked or
        RunFailed or
        WorkItemClosed;
}