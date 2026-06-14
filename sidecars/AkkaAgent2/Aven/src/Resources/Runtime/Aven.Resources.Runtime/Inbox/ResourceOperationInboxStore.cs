using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Aven.Resources.Runtime.Inbox;

public interface IResourceOperationInboxStore
{
    int MaxPayloadBytes { get; }

    Task<ResourceOperationInboxStore.RecordIntentResult> RecordIntentAsync(
        ResourceOperationInboxRecord candidate,
        CancellationToken cancellationToken = default);

    Task<ResourceOperationInboxRecord?> GetAsync(string operationKey, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ResourceOperationInboxRecord>> ListRecoverableAsync(
        string resourceKind,
        CancellationToken cancellationToken = default);

    Task<ResourceOperationInboxRecord?> MarkProcessingAsync(string operationKey, CancellationToken cancellationToken = default);

    Task<ResourceOperationInboxRecord?> MarkCompletedAsync(string operationKey, CancellationToken cancellationToken = default);

    Task<ResourceOperationInboxRecord?> MarkFailedAsync(
        string operationKey,
        string errorCode,
        string errorMessage,
        CancellationToken cancellationToken = default);

    Task<ResourceOperationInboxRecord?> TryRecordTerminalReplyPendingAsync(
        string operationKey,
        ResourceOperationInboxStore.TerminalReplyRecord terminalReply,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ResourceOperationInboxRecord>> ListPendingTerminalRepliesAsync(
        string resourceKind,
        CancellationToken cancellationToken = default);

    Task<ResourceOperationInboxRecord?> MarkTerminalReplyDeliveredAsync(
        string operationKey,
        CancellationToken cancellationToken = default);
}

public sealed class ResourceOperationInboxStore : IResourceOperationInboxStore
{
    private readonly string _connectionString;
    private readonly ResourceOperationInboxOptions _options;

    public ResourceOperationInboxStore(
        string connectionString,
        ResourceOperationInboxOptions? options = null)
    {
        _connectionString = string.IsNullOrWhiteSpace(connectionString)
            ? throw new ArgumentException("Resource operation inbox connection string is required.", nameof(connectionString))
            : connectionString;
        _options = options ?? new ResourceOperationInboxOptions();
        EnsureSchema();
    }

    public int MaxPayloadBytes => _options.MaxPayloadBytes;

    public async Task<RecordIntentResult> RecordIntentAsync(
        ResourceOperationInboxRecord candidate,
        CancellationToken cancellationToken = default)
    {
        ValidatePayloadSize(candidate.PayloadJson);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var existing = await GetAsync(connection, transaction, candidate.OperationKey, cancellationToken);
        if (existing is null)
        {
            await InsertAsync(connection, transaction, candidate, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new RecordIntentResult(candidate, RecordIntentDisposition.Inserted);
        }

        if (!string.Equals(existing.PayloadHash, candidate.PayloadHash, StringComparison.Ordinal)
            || !string.Equals(NormalizeCapabilityId(existing.ResolvedCapabilityId), NormalizeCapabilityId(candidate.ResolvedCapabilityId), StringComparison.Ordinal))
        {
            throw new ResourceOperationInboxConflictException(candidate.OperationKey);
        }

        await transaction.CommitAsync(cancellationToken);
        return new RecordIntentResult(existing, Classify(existing));
    }

    public async Task<ResourceOperationInboxRecord?> GetAsync(string operationKey, CancellationToken cancellationToken = default)
    {
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        return await GetAsync(connection, transaction: null, operationKey, cancellationToken);
    }

    public async Task<IReadOnlyList<ResourceOperationInboxRecord>> ListRecoverableAsync(
        string resourceKind,
        CancellationToken cancellationToken = default)
    {
        var rows = new List<ResourceOperationInboxRecord>();
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select operation_key, caller_value, caller_protocol, request_id, operation_type,
                   resource_kind, recipient_value, recipient_protocol, reply_to_value, reply_to_protocol,
                   correlation_id, payload_json, payload_hash, status, accepted_at, started_at,
                   completed_at, last_error_code, last_error_message, attempt_count, resolved_capability_id,
                   terminal_reply_kind, terminal_reply_payload_json, terminal_reply_delivery_status, terminal_reply_delivered_at
            from resource_operation_inbox
            where resource_kind = $resourceKind
            order by accepted_at asc;
            """;
        Bind(command, "$resourceKind", resourceKind);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var record = Read(reader);
            if (record.Status is ResourceOperationInboxStatus.Recorded or ResourceOperationInboxStatus.Processing)
            {
                rows.Add(record);
            }
        }

        return rows;
    }

    public async Task<IReadOnlyList<ResourceOperationInboxRecord>> ListPendingTerminalRepliesAsync(
        string resourceKind,
        CancellationToken cancellationToken = default)
    {
        var rows = new List<ResourceOperationInboxRecord>();
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            select operation_key, caller_value, caller_protocol, request_id, operation_type,
                   resource_kind, recipient_value, recipient_protocol, reply_to_value, reply_to_protocol,
                   correlation_id, payload_json, payload_hash, status, accepted_at, started_at,
                   completed_at, last_error_code, last_error_message, attempt_count, resolved_capability_id,
                   terminal_reply_kind, terminal_reply_payload_json, terminal_reply_delivery_status, terminal_reply_delivered_at
            from resource_operation_inbox
            where resource_kind = $resourceKind
              and terminal_reply_delivery_status = $pending
            order by completed_at asc, accepted_at asc;
            """;
        Bind(command, "$resourceKind", resourceKind);
        Bind(command, "$pending", ResourceOperationTerminalReplyDeliveryStatus.Pending.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(Read(reader));
        }

        return rows;
    }

    public async Task<ResourceOperationInboxRecord?> MarkProcessingAsync(string operationKey, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update resource_operation_inbox
            set status = $status,
                started_at = coalesce(started_at, $startedAt),
                attempt_count = attempt_count + 1
            where operation_key = $operationKey;
            """;
        Bind(command, "$status", ResourceOperationInboxStatus.Processing.ToString());
        Bind(command, "$startedAt", FormatTime(now));
        Bind(command, "$operationKey", operationKey);
        await command.ExecuteNonQueryAsync(cancellationToken);
        var updated = await GetAsync(connection, transaction, operationKey, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<ResourceOperationInboxRecord?> MarkCompletedAsync(string operationKey, CancellationToken cancellationToken = default)
        => await MarkTerminalAsync(operationKey, ResourceOperationInboxStatus.Completed, null, null, cancellationToken);

    public async Task<ResourceOperationInboxRecord?> MarkFailedAsync(
        string operationKey,
        string errorCode,
        string errorMessage,
        CancellationToken cancellationToken = default)
        => await MarkTerminalAsync(operationKey, ResourceOperationInboxStatus.Failed, errorCode, errorMessage, cancellationToken);

    public async Task<ResourceOperationInboxRecord?> TryRecordTerminalReplyPendingAsync(
        string operationKey,
        TerminalReplyRecord terminalReply,
        CancellationToken cancellationToken = default)
    {
        if (terminalReply.TerminalStatus is not (ResourceOperationInboxStatus.Completed or ResourceOperationInboxStatus.Failed))
        {
            throw new ArgumentOutOfRangeException(nameof(terminalReply), terminalReply.TerminalStatus, "Terminal reply status must be Completed or Failed.");
        }

        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var existing = await GetAsync(connection, transaction, operationKey, cancellationToken);
        if (existing is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var sameReply = HasSameTerminalReply(existing, terminalReply);
        if (existing.TerminalReplyDeliveryStatus is ResourceOperationTerminalReplyDeliveryStatus.Delivered)
        {
            if (!sameReply)
            {
                throw new ResourceOperationInboxConflictException(operationKey);
            }

            await transaction.CommitAsync(cancellationToken);
            return existing;
        }

        if (existing.TerminalReplyDeliveryStatus is ResourceOperationTerminalReplyDeliveryStatus.Pending)
        {
            if (!sameReply)
            {
                throw new ResourceOperationInboxConflictException(operationKey);
            }

            await transaction.CommitAsync(cancellationToken);
            return existing;
        }

        if (existing.Status is ResourceOperationInboxStatus.Completed or ResourceOperationInboxStatus.Failed)
        {
            if (existing.Status != terminalReply.TerminalStatus)
            {
                throw new ResourceOperationInboxConflictException(operationKey);
            }

            if (!sameReply && HasExistingTerminalReply(existing))
            {
                throw new ResourceOperationInboxConflictException(operationKey);
            }
        }

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update resource_operation_inbox
            set status = $status,
                completed_at = coalesce(completed_at, $completedAt),
                last_error_code = $errorCode,
                last_error_message = $errorMessage,
                terminal_reply_kind = $terminalReplyKind,
                terminal_reply_payload_json = $terminalReplyPayloadJson,
                terminal_reply_delivery_status = $terminalReplyDeliveryStatus,
                terminal_reply_delivered_at = null
            where operation_key = $operationKey;
            """;
        Bind(command, "$status", terminalReply.TerminalStatus.ToString());
        Bind(command, "$completedAt", FormatTime(now));
        Bind(command, "$errorCode", terminalReply.ErrorCode);
        Bind(command, "$errorMessage", terminalReply.ErrorMessage);
        Bind(command, "$terminalReplyKind", terminalReply.ReplyKind);
        Bind(command, "$terminalReplyPayloadJson", terminalReply.ReplyPayloadJson);
        Bind(command, "$terminalReplyDeliveryStatus", ResourceOperationTerminalReplyDeliveryStatus.Pending.ToString());
        Bind(command, "$operationKey", operationKey);
        await command.ExecuteNonQueryAsync(cancellationToken);

        var updated = await GetAsync(connection, transaction, operationKey, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<ResourceOperationInboxRecord?> MarkTerminalReplyDeliveredAsync(
        string operationKey,
        CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update resource_operation_inbox
            set terminal_reply_delivery_status = $status,
                terminal_reply_delivered_at = coalesce(terminal_reply_delivered_at, $deliveredAt)
            where operation_key = $operationKey
              and terminal_reply_delivery_status = $pending;
            """;
        Bind(command, "$status", ResourceOperationTerminalReplyDeliveryStatus.Delivered.ToString());
        Bind(command, "$deliveredAt", FormatTime(now));
        Bind(command, "$operationKey", operationKey);
        Bind(command, "$pending", ResourceOperationTerminalReplyDeliveryStatus.Pending.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
        var updated = await GetAsync(connection, transaction, operationKey, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return updated;
    }

    private async Task<ResourceOperationInboxRecord?> MarkTerminalAsync(
        string operationKey,
        ResourceOperationInboxStatus status,
        string? errorCode,
        string? errorMessage,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await ApplyPragmasAsync(connection, cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            update resource_operation_inbox
            set status = $status,
                completed_at = $completedAt,
                last_error_code = $errorCode,
                last_error_message = $errorMessage
            where operation_key = $operationKey;
            """;
        Bind(command, "$status", status.ToString());
        Bind(command, "$completedAt", FormatTime(now));
        Bind(command, "$errorCode", errorCode);
        Bind(command, "$errorMessage", errorMessage);
        Bind(command, "$operationKey", operationKey);
        await command.ExecuteNonQueryAsync(cancellationToken);
        var updated = await GetAsync(connection, transaction, operationKey, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return updated;
    }

    private void EnsureSchema()
    {
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            pragma busy_timeout = 5000;
            pragma foreign_keys = on;

            create table if not exists resource_operation_inbox(
              operation_key text primary key,
              caller_value text not null,
              caller_protocol text not null,
              request_id text not null,
              operation_type text not null,
              resource_kind text not null,
              recipient_value text not null,
              recipient_protocol text not null,
              reply_to_value text not null,
              reply_to_protocol text not null,
              correlation_id text not null,
              payload_json text not null,
              payload_hash text not null,
              resolved_capability_id text null,
              terminal_reply_kind text null,
              terminal_reply_payload_json text null,
              terminal_reply_delivery_status text null,
              terminal_reply_delivered_at text null,
              status text not null,
              accepted_at text not null,
              started_at text null,
              completed_at text null,
              last_error_code text null,
              last_error_message text null,
              attempt_count integer not null default 0
            );

            create index if not exists ix_resource_operation_inbox_status
              on resource_operation_inbox(resource_kind, status, accepted_at);
            """;
        command.ExecuteNonQuery();

        EnsureColumnExists(connection, "resource_operation_inbox", "resolved_capability_id", "text null");
        EnsureColumnExists(connection, "resource_operation_inbox", "terminal_reply_kind", "text null");
        EnsureColumnExists(connection, "resource_operation_inbox", "terminal_reply_payload_json", "text null");
        EnsureColumnExists(connection, "resource_operation_inbox", "terminal_reply_delivery_status", "text null");
        EnsureColumnExists(connection, "resource_operation_inbox", "terminal_reply_delivered_at", "text null");
    }

    private async Task<ResourceOperationInboxRecord?> GetAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        string operationKey,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            select operation_key, caller_value, caller_protocol, request_id, operation_type,
                   resource_kind, recipient_value, recipient_protocol, reply_to_value, reply_to_protocol,
                   correlation_id, payload_json, payload_hash, status, accepted_at, started_at,
                   completed_at, last_error_code, last_error_message, attempt_count, resolved_capability_id,
                   terminal_reply_kind, terminal_reply_payload_json, terminal_reply_delivery_status, terminal_reply_delivered_at
            from resource_operation_inbox
            where operation_key = $operationKey
            limit 1;
            """;
        Bind(command, "$operationKey", operationKey);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    private static async Task InsertAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ResourceOperationInboxRecord record,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            insert into resource_operation_inbox(
              operation_key, caller_value, caller_protocol, request_id, operation_type,
              resource_kind, recipient_value, recipient_protocol, reply_to_value, reply_to_protocol,
              correlation_id, payload_json, payload_hash, resolved_capability_id, terminal_reply_kind, terminal_reply_payload_json,
              terminal_reply_delivery_status, terminal_reply_delivered_at, status, accepted_at, started_at,
              completed_at, last_error_code, last_error_message, attempt_count)
            values(
              $operationKey, $callerValue, $callerProtocol, $requestId, $operationType,
              $resourceKind, $recipientValue, $recipientProtocol, $replyToValue, $replyToProtocol,
              $correlationId, $payloadJson, $payloadHash, $resolvedCapabilityId, $terminalReplyKind, $terminalReplyPayloadJson,
              $terminalReplyDeliveryStatus, $terminalReplyDeliveredAt, $status, $acceptedAt, $startedAt,
              $completedAt, $lastErrorCode, $lastErrorMessage, $attemptCount);
            """;
        Bind(command, "$operationKey", record.OperationKey);
        Bind(command, "$callerValue", record.CallerValue);
        Bind(command, "$callerProtocol", record.CallerProtocol);
        Bind(command, "$requestId", record.RequestId);
        Bind(command, "$operationType", record.OperationType);
        Bind(command, "$resourceKind", record.ResourceKind);
        Bind(command, "$recipientValue", record.RecipientValue);
        Bind(command, "$recipientProtocol", record.RecipientProtocol);
        Bind(command, "$replyToValue", record.ReplyToValue);
        Bind(command, "$replyToProtocol", record.ReplyToProtocol);
        Bind(command, "$correlationId", record.CorrelationId);
        Bind(command, "$payloadJson", record.PayloadJson);
        Bind(command, "$payloadHash", record.PayloadHash);
        Bind(command, "$resolvedCapabilityId", record.ResolvedCapabilityId);
        Bind(command, "$terminalReplyKind", record.TerminalReplyKind);
        Bind(command, "$terminalReplyPayloadJson", record.TerminalReplyPayloadJson);
        Bind(command, "$terminalReplyDeliveryStatus", record.TerminalReplyDeliveryStatus?.ToString());
        Bind(command, "$terminalReplyDeliveredAt", record.TerminalReplyDeliveredAt is null ? null : FormatTime(record.TerminalReplyDeliveredAt.Value));
        Bind(command, "$status", record.Status.ToString());
        Bind(command, "$acceptedAt", FormatTime(record.AcceptedAt));
        Bind(command, "$startedAt", record.StartedAt is null ? null : FormatTime(record.StartedAt.Value));
        Bind(command, "$completedAt", record.CompletedAt is null ? null : FormatTime(record.CompletedAt.Value));
        Bind(command, "$lastErrorCode", record.LastErrorCode);
        Bind(command, "$lastErrorMessage", record.LastErrorMessage);
        Bind(command, "$attemptCount", record.AttemptCount);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private void ValidatePayloadSize(string payloadJson)
    {
        var bytes = System.Text.Encoding.UTF8.GetByteCount(payloadJson ?? string.Empty);
        if (bytes > _options.MaxPayloadBytes)
        {
            throw new ResourceOperationInboxPayloadTooLargeException(bytes, _options.MaxPayloadBytes);
        }
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "pragma busy_timeout = 5000; pragma foreign_keys = on;";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static ResourceOperationInboxRecord Read(SqliteDataReader reader) =>
        new(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetString(7),
            reader.GetString(8),
            reader.GetString(9),
            reader.GetString(10),
            reader.GetString(11),
            reader.GetString(12),
            ParseStatus(reader.GetString(13)),
            ParseTime(reader.GetString(14)),
            NullTime(reader, 15),
            NullTime(reader, 16),
            NullString(reader, 17),
            NullString(reader, 18),
            reader.GetInt32(19),
            NullString(reader, 20),
            NullString(reader, 21),
            NullString(reader, 22),
            NullTerminalReplyDeliveryStatus(reader, 23),
            NullTime(reader, 24));

    private static ResourceOperationInboxStatus ParseStatus(string value)
        => Enum.Parse<ResourceOperationInboxStatus>(value, ignoreCase: true);

    private static DateTimeOffset ParseTime(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
    private static string FormatTime(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    private static string? NullString(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    private static DateTimeOffset? NullTime(SqliteDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : ParseTime(reader.GetString(ordinal));
    private static ResourceOperationTerminalReplyDeliveryStatus? NullTerminalReplyDeliveryStatus(SqliteDataReader reader, int ordinal)
        => reader.IsDBNull(ordinal)
            ? null
            : Enum.Parse<ResourceOperationTerminalReplyDeliveryStatus>(reader.GetString(ordinal), ignoreCase: true);
    private static void Bind(SqliteCommand command, string name, object? value) => command.Parameters.AddWithValue(name, value ?? DBNull.Value);

    private static void EnsureColumnExists(SqliteConnection connection, string tableName, string columnName, string columnDefinition)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"pragma table_info({tableName});";
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            if (string.Equals(reader.GetString(1), columnName, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }
        }

        using var alter = connection.CreateCommand();
        alter.CommandText = $"alter table {tableName} add column {columnName} {columnDefinition};";
        alter.ExecuteNonQuery();
    }

    private static RecordIntentDisposition Classify(ResourceOperationInboxRecord record) =>
        record.Status switch
        {
            ResourceOperationInboxStatus.Recorded or ResourceOperationInboxStatus.Processing => RecordIntentDisposition.AlreadyRecordedNonTerminal,
            ResourceOperationInboxStatus.Completed or ResourceOperationInboxStatus.Failed => RecordIntentDisposition.AlreadyRecordedTerminal,
            _ => throw new ArgumentOutOfRangeException(nameof(record), record.Status, "Unsupported inbox status.")
        };

    private static string NormalizeCapabilityId(string? capabilityId)
        => string.IsNullOrWhiteSpace(capabilityId) ? string.Empty : capabilityId;

    private static bool HasSameTerminalReply(ResourceOperationInboxRecord existing, TerminalReplyRecord terminalReply)
        => existing.Status == terminalReply.TerminalStatus
           && string.Equals(existing.LastErrorCode, terminalReply.ErrorCode, StringComparison.Ordinal)
           && string.Equals(existing.LastErrorMessage, terminalReply.ErrorMessage, StringComparison.Ordinal)
           && string.Equals(existing.TerminalReplyKind, terminalReply.ReplyKind, StringComparison.Ordinal)
           && string.Equals(existing.TerminalReplyPayloadJson, terminalReply.ReplyPayloadJson, StringComparison.Ordinal);

    private static bool HasExistingTerminalReply(ResourceOperationInboxRecord existing)
        => !string.IsNullOrWhiteSpace(existing.TerminalReplyKind)
           || existing.TerminalReplyPayloadJson is not null
           || existing.TerminalReplyDeliveryStatus is not null;

    public sealed record RecordIntentResult(ResourceOperationInboxRecord Record, RecordIntentDisposition Disposition)
    {
        public bool IsNonTerminal => Record.Status is ResourceOperationInboxStatus.Recorded or ResourceOperationInboxStatus.Processing;
        public bool IsTerminal => !IsNonTerminal;
    }

    public enum RecordIntentDisposition
    {
        Inserted,
        AlreadyRecordedNonTerminal,
        AlreadyRecordedTerminal
    }

    public sealed record TerminalReplyRecord(
        ResourceOperationInboxStatus TerminalStatus,
        string ReplyKind,
        string ReplyPayloadJson,
        string? ErrorCode,
        string? ErrorMessage);

    public sealed class ResourceOperationInboxConflictException(string operationKey)
        : InvalidOperationException($"Resource operation conflict for operation key '{operationKey}'.");

    public sealed class ResourceOperationInboxPayloadTooLargeException(int payloadBytes, int maxPayloadBytes)
        : InvalidOperationException($"Resource operation payload size {payloadBytes} bytes exceeds max {maxPayloadBytes} bytes.");
}