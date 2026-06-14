using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Aven.RoleAgents;

public sealed class RoleAgentLedgerStore : IRoleAgentLedgerQuery
{
    private const int DefaultLimit = 50;
    private const int MaxLimit = 200;
    private readonly string _connectionString;

    public RoleAgentLedgerStore(string connectionString)
    {
        _connectionString = connectionString;
        EnsureSchema();
    }

    public async Task ApplyAsync(IAvenEventEnvelope envelope, CancellationToken cancellationToken = default)
    {
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        switch (envelope.Data)
        {
            case WorkItemOpened opened:
                await InsertWorkItemAsync(connection, transaction, opened, cancellationToken);
                break;
            case RunStarted started:
                await InsertRunAsync(connection, transaction, started, cancellationToken);
                break;
            case OperationRequested requested:
                await InsertOperationAsync(connection, transaction, requested, cancellationToken);
                break;
            case OperationCompleted completed:
                await CompleteOperationAsync(connection, transaction, completed, cancellationToken);
                break;
            case Aven.RoleAgents.Contracts.Ledger.OperationFailed failed:
                await FailOperationAsync(connection, transaction, failed, cancellationToken);
                break;
            case RunCompleted completed:
                await CompleteRunAsync(connection, transaction, completed, RunStatus.Completed.ToString(), completed.Summary, null, null, completed.CompletedAt, cancellationToken);
                break;
            case RunBlocked blocked:
                await CompleteRunAsync(connection, transaction, blocked, RunStatus.Blocked.ToString(), null, blocked.Reason, null, blocked.BlockedAt, cancellationToken);
                break;
            case RunFailed failed:
                await CompleteRunAsync(connection, transaction, failed, RunStatus.Failed.ToString(), null, null, failed.Reason, failed.FailedAt, cancellationToken);
                break;
            case WorkItemClosed closed:
                await CloseWorkItemAsync(connection, transaction, closed, cancellationToken);
                break;
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<WorkItemSnapshot>> ListWorkItemsAsync(
        RoleAgentId roleAgentId,
        WorkItemStatus? status,
        int? limit,
        CancellationToken cancellationToken)
    {
        var bounded = BoundLimit(limit);
        var rows = new List<WorkItemSnapshot>();

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select work_item_id, role_agent_id, status, subject, input_summary, input_artifact_id, input_artifact_revision_id, opened_at, closed_at, outcome
            from role_work_items
            where role_agent_id = $roleAgentId
              and ($status is null or status = $status)
            order by opened_at desc
            limit $limit;
            """;
        Bind(command, "$roleAgentId", roleAgentId.Value);
        Bind(command, "$status", status?.ToString());
        Bind(command, "$limit", bounded);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new WorkItemSnapshot(
                new WorkItemId(reader.GetString(0)),
                new RoleAgentId(reader.GetString(1)),
                Enum.Parse<WorkItemStatus>(reader.GetString(2), ignoreCase: true),
                reader.GetString(3),
                NullString(reader, 4),
                ReadArtifactRef(reader, 5, 6),
                ParseTime(reader.GetString(7)),
                NullTime(reader, 8),
                NullString(reader, 9)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<RunSnapshot>> ListRunsAsync(
        RoleAgentId roleAgentId,
        WorkItemId? workItemId,
        RunStatus? status,
        int? limit,
        CancellationToken cancellationToken)
    {
        var bounded = BoundLimit(limit);
        var rows = new List<RunSnapshot>();

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select run_id, work_item_id, role_agent_id, status, goal, started_at, completed_at, summary, blocked_reason, failure_reason
            from role_runs
            where role_agent_id = $roleAgentId
              and ($workItemId is null or work_item_id = $workItemId)
              and ($status is null or status = $status)
            order by started_at desc
            limit $limit;
            """;
        Bind(command, "$roleAgentId", roleAgentId.Value);
        Bind(command, "$workItemId", workItemId?.Value);
        Bind(command, "$status", status?.ToString());
        Bind(command, "$limit", bounded);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new RunSnapshot(
                new RunId(reader.GetString(0)),
                new WorkItemId(reader.GetString(1)),
                new RoleAgentId(reader.GetString(2)),
                Enum.Parse<RunStatus>(reader.GetString(3), ignoreCase: true),
                reader.GetString(4),
                ParseTime(reader.GetString(5)),
                NullTime(reader, 6),
                NullString(reader, 7),
                NullString(reader, 8),
                NullString(reader, 9)));
        }

        return rows;
    }

    public async Task<IReadOnlyList<OperationSnapshot>> ListOperationsAsync(
        RoleAgentId roleAgentId,
        RunId? runId,
        OperationStatus? status,
        int? limit,
        CancellationToken cancellationToken)
    {
        var bounded = BoundLimit(limit);
        var rows = new List<OperationSnapshot>();

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select operation_id, run_id, work_item_id, role_agent_id, status, operation_key, target_kind, contract_id, input_json, result_json, failure_reason, retryable, requested_at, completed_at
            from role_operations
            where role_agent_id = $roleAgentId
              and ($runId is null or run_id = $runId)
              and ($status is null or status = $status)
            order by requested_at desc
            limit $limit;
            """;
        Bind(command, "$roleAgentId", roleAgentId.Value);
        Bind(command, "$runId", runId?.Value);
        Bind(command, "$status", status?.ToString());
        Bind(command, "$limit", bounded);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new OperationSnapshot(
                new OperationId(reader.GetString(0)),
                new RunId(reader.GetString(1)),
                new WorkItemId(reader.GetString(2)),
                new RoleAgentId(reader.GetString(3)),
                Enum.Parse<OperationStatus>(reader.GetString(4), ignoreCase: true),
                ParseOperationKey(reader.GetString(5)),
                reader.GetString(6),
                reader.GetString(7),
                reader.GetString(8),
                NullString(reader, 9),
                NullString(reader, 10),
                NullBool(reader, 11),
                ParseTime(reader.GetString(12)),
                NullTime(reader, 13)));
        }

        return rows;
    }

    public async Task<bool> HasClosedWorkItemAsync(
        RoleAgentId roleAgentId,
        WorkItemId workItemId,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select 1
            from role_work_items
            where role_agent_id = $roleAgentId
              and work_item_id = $workItemId
              and status = $status
            limit 1;
            """;
        Bind(command, "$roleAgentId", roleAgentId.Value);
        Bind(command, "$workItemId", workItemId.Value);
        Bind(command, "$status", WorkItemStatus.Closed.ToString());
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is not null && result != DBNull.Value;
    }

    private void EnsureSchema()
    {
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            pragma busy_timeout = 5000;
            pragma foreign_keys = on;

            create table if not exists role_work_items(
              work_item_id text primary key,
              role_agent_id text not null,
              status text not null,
              subject text not null,
              input_summary text null,
              input_artifact_id text null,
              input_artifact_revision_id text null,
              opened_at text not null,
              closed_at text null,
              outcome text null
            );

            create table if not exists role_runs(
              run_id text primary key,
              work_item_id text not null,
              role_agent_id text not null,
              status text not null,
              goal text not null,
              started_at text not null,
              completed_at text null,
              summary text null,
              blocked_reason text null,
              failure_reason text null
            );

            create table if not exists role_operations(
              operation_id text primary key,
              run_id text not null,
              work_item_id text not null,
              role_agent_id text not null,
              status text not null,
              operation_key text not null,
              target_kind text not null,
              contract_id text not null,
              input_json text not null,
              result_json text null,
              failure_reason text null,
              retryable integer null,
              requested_at text not null,
              completed_at text null
            );

            create index if not exists ix_role_work_items_role_agent_status on role_work_items(role_agent_id, status);
            create index if not exists ix_role_runs_work_item on role_runs(work_item_id);
            create index if not exists ix_role_runs_role_agent_status on role_runs(role_agent_id, status);
            create index if not exists ix_role_operations_run on role_operations(run_id);
            create index if not exists ix_role_operations_operation_key on role_operations(operation_key);
            create index if not exists ix_role_operations_role_agent_status on role_operations(role_agent_id, status);
            """;
        command.ExecuteNonQuery();
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "pragma busy_timeout = 5000; pragma foreign_keys = on;";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertWorkItemAsync(SqliteConnection connection, SqliteTransaction transaction, WorkItemOpened opened, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert or replace into role_work_items(work_item_id, role_agent_id, status, subject, input_summary, input_artifact_id, input_artifact_revision_id, opened_at, closed_at, outcome)
            values($workItemId, $roleAgentId, $status, $subject, $inputSummary, $inputArtifactId, $inputArtifactRevisionId, $openedAt, null, null);
            """;
        Bind(command, "$workItemId", opened.WorkItemId.Value);
        Bind(command, "$roleAgentId", opened.RoleAgentId.Value);
        Bind(command, "$status", WorkItemStatus.Open.ToString());
        Bind(command, "$subject", opened.Subject);
        Bind(command, "$inputSummary", opened.InputSummary);
        Bind(command, "$inputArtifactId", opened.InputArtifact?.ArtifactId.Value);
        Bind(command, "$inputArtifactRevisionId", opened.InputArtifact?.RevisionId?.Value);
        Bind(command, "$openedAt", FormatTime(opened.OpenedAt));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertRunAsync(SqliteConnection connection, SqliteTransaction transaction, RunStarted started, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert or replace into role_runs(run_id, work_item_id, role_agent_id, status, goal, started_at, completed_at, summary, blocked_reason, failure_reason)
            values($runId, $workItemId, $roleAgentId, $status, $goal, $startedAt, null, null, null, null);
            """;
        Bind(command, "$runId", started.RunId.Value);
        Bind(command, "$workItemId", started.WorkItemId.Value);
        Bind(command, "$roleAgentId", started.RoleAgentId.Value);
        Bind(command, "$status", RunStatus.Running.ToString());
        Bind(command, "$goal", started.Goal);
        Bind(command, "$startedAt", FormatTime(started.StartedAt));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertOperationAsync(SqliteConnection connection, SqliteTransaction transaction, OperationRequested requested, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert or replace into role_operations(operation_id, run_id, work_item_id, role_agent_id, status, operation_key, target_kind, contract_id, input_json, result_json, failure_reason, retryable, requested_at, completed_at)
            values($operationId, $runId, $workItemId, $roleAgentId, $status, $operationKey, $targetKind, $contractId, $inputJson, null, null, null, $requestedAt, null);
            """;
        Bind(command, "$operationId", requested.OperationId.Value);
        Bind(command, "$runId", requested.RunId.Value);
        Bind(command, "$workItemId", requested.WorkItemId.Value);
        Bind(command, "$roleAgentId", requested.RoleAgentId.Value);
        Bind(command, "$status", OperationStatus.Requested.ToString());
        Bind(command, "$operationKey", FormatOperationKey(requested.OperationKey));
        Bind(command, "$targetKind", requested.TargetKind);
        Bind(command, "$contractId", requested.ContractId);
        Bind(command, "$inputJson", requested.InputJson);
        Bind(command, "$requestedAt", FormatTime(requested.RequestedAt));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task CompleteOperationAsync(SqliteConnection connection, SqliteTransaction transaction, OperationCompleted completed, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update role_operations
            set status = $status,
                result_json = $resultJson,
                completed_at = $completedAt
            where operation_id = $operationId;
            """;
        Bind(command, "$status", OperationStatus.Completed.ToString());
        Bind(command, "$resultJson", completed.ResultJson);
        Bind(command, "$completedAt", FormatTime(completed.CompletedAt));
        Bind(command, "$operationId", completed.OperationId.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task FailOperationAsync(SqliteConnection connection, SqliteTransaction transaction, Aven.RoleAgents.Contracts.Ledger.OperationFailed failed, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update role_operations
            set status = $status,
                failure_reason = $failureReason,
                retryable = $retryable,
                completed_at = $completedAt
            where operation_id = $operationId;
            """;
        Bind(command, "$status", OperationStatus.Failed.ToString());
        Bind(command, "$failureReason", failed.Reason);
        Bind(command, "$retryable", failed.Retryable ? 1 : 0);
        Bind(command, "$completedAt", FormatTime(failed.FailedAt));
        Bind(command, "$operationId", failed.OperationId.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task CompleteRunAsync(SqliteConnection connection, SqliteTransaction transaction, object terminalEvent, string status, string? summary, string? blockedReason, string? failureReason, DateTimeOffset completedAt, CancellationToken cancellationToken)
    {
        var runId = terminalEvent switch
        {
            RunCompleted completed => completed.RunId.Value,
            RunBlocked blocked => blocked.RunId.Value,
            RunFailed failed => failed.RunId.Value,
            _ => throw new InvalidOperationException($"Unsupported terminal run event {terminalEvent.GetType().Name}.")
        };

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update role_runs
            set status = $status,
                completed_at = $completedAt,
                summary = coalesce($summary, summary),
                blocked_reason = $blockedReason,
                failure_reason = $failureReason
            where run_id = $runId;
            """;
        Bind(command, "$status", status);
        Bind(command, "$completedAt", FormatTime(completedAt));
        Bind(command, "$summary", summary);
        Bind(command, "$blockedReason", blockedReason);
        Bind(command, "$failureReason", failureReason);
        Bind(command, "$runId", runId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task CloseWorkItemAsync(SqliteConnection connection, SqliteTransaction transaction, WorkItemClosed closed, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update role_work_items
            set status = $status,
                closed_at = $closedAt,
                outcome = $outcome
            where work_item_id = $workItemId;
            """;
        Bind(command, "$status", WorkItemStatus.Closed.ToString());
        Bind(command, "$closedAt", FormatTime(closed.ClosedAt));
        Bind(command, "$outcome", closed.Outcome);
        Bind(command, "$workItemId", closed.WorkItemId.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static int BoundLimit(int? limit) => Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

    private static string FormatTime(DateTimeOffset value) => value.ToString("O", CultureInfo.InvariantCulture);
    private static DateTimeOffset ParseTime(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    private static string? NullString(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    private static DateTimeOffset? NullTime(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : ParseTime(reader.GetString(ordinal));
    private static bool? NullBool(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetInt32(ordinal) != 0;

    private static ArtifactRef? ReadArtifactRef(SqliteDataReader reader, int artifactOrdinal, int revisionOrdinal)
    {
        if (reader.IsDBNull(artifactOrdinal))
        {
            return null;
        }

        var artifactId = new Aven.Toolkit.Core.Identifiers.ArtifactId(reader.GetString(artifactOrdinal));
        Aven.Toolkit.Core.Identifiers.ArtifactRevisionId? revisionId = reader.IsDBNull(revisionOrdinal)
            ? null
            : new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId(reader.GetString(revisionOrdinal));
        return new ArtifactRef(artifactId, revisionId);
    }

    private static string FormatOperationKey(OperationKey key) => JsonSerializer.Serialize(new
    {
        callerValue = key.Caller.Value,
        callerProtocol = key.Caller.Protocol,
        requestId = key.RequestId.Value,
        operationType = key.OperationType
    });

    private static OperationKey ParseOperationKey(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        return new OperationKey(
            new ActorAddress(root.GetProperty("callerValue").GetString()!, root.GetProperty("callerProtocol").GetString()!),
            new RequestId(root.GetProperty("requestId").GetString()!),
            root.GetProperty("operationType").GetString()!);
    }

    private static void Bind(SqliteCommand command, string name, object? value) => command.Parameters.AddWithValue(name, value ?? DBNull.Value);
}