using System.Collections.Concurrent;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Aven.Contracts.Protocol;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Trace;

public sealed class TraceEventMapper
{
    public const int DefaultMaxDetailsBytes = 8192;
    private static readonly JsonSerializerOptions JsonOptions = new(CanonicalJsonSerializer.DefaultOptions) { WriteIndented = false };
    private static readonly ConcurrentDictionary<Type, PropertyInfo[]> ScalarProperties = new();
    private static readonly HashSet<string> KnownIds = new(StringComparer.Ordinal)
    {
        "RoleAgentId", "TargetRoleAgentId", "OwnerRoleAgentId", "SelectedRoleAgentId", "RoutingAttemptId", "OfferId", "ClaimId", "PromptId",
        "ScheduleId", "ScheduleOccurrenceId", "OccurrenceId", "LlmRequestId", "ArtifactId", "ArtifactRevisionId", "MetadataRecordId",
        "SchemaId", "SchemaVersion", "SchemaRef", "ProviderFileId", "ProviderFileKey", "CommandId", "DeliveryId", "OperationKey", "Key"
    };
    private static readonly HashSet<string> SecretNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "apiKey", "authorization", "bearer", "password", "secret", "token", "accessToken", "refreshToken"
    };

    private readonly int _maxDetailsBytes;
    public TraceEventMapper(int maxDetailsBytes = DefaultMaxDetailsBytes) => _maxDetailsBytes = maxDetailsBytes;

    internal TraceProjectionDelta Map(IAvenEventEnvelope envelope)
    {
        var meta = envelope.Meta;
        var eventType = meta.EventType;
        var data = envelope.Data;
        var (details, truncated) = BuildDetails(data);
        var record = new TraceEventRecord(
            meta.EventId,
            eventType,
            meta.EventVersion,
            FormatValue(meta.ActorAddress),
            meta.ActorKind,
            meta.CommandId?.Value,
            meta.DeliveryId?.Value,
            meta.OperationKey is null ? null : FormatValue(meta.OperationKey),
            meta.CorrelationId.Value,
            meta.CausationId?.Value,
            meta.PayloadHash,
            meta.OccurredAt,
            TraceSummaryBuilder.Build(eventType, meta.ActorKind, data),
            details,
            truncated);

        var entities = new Dictionary<(string, string), TraceEntityRecord>();
        var links = new Dictionary<string, TraceLinkRecord>(StringComparer.Ordinal);
        AddEntity(entities, "correlation", meta.CorrelationId.Value, "active", $"Correlation {meta.CorrelationId.Value}", record);
        AddLink(links, "correlation", meta.CorrelationId.Value, "event", meta.EventId, "contains_event", record);
        AddEntity(entities, "event", meta.EventId, "recorded", eventType, record);
        AddEntity(entities, "actor", FormatValue(meta.ActorAddress), "active", meta.ActorKind, record);
        AddLink(links, "actor", FormatValue(meta.ActorAddress), "event", meta.EventId, "emitted", record);
        if (meta.CommandId is { } commandId) AddStandard(entities, links, "command", commandId.Value, EntityStatus("command", eventType), record);
        if (meta.DeliveryId is { } deliveryId) AddStandard(entities, links, "delivery", deliveryId.Value, EntityStatus("delivery", eventType), record);
        if (meta.OperationKey is { } operationKey) AddStandard(entities, links, "operation", FormatValue(operationKey), EntityStatus("operation", eventType), record);

        foreach (var (type, id) in ExtractKnownIds(data))
        {
            AddStandard(entities, links, type, id, EntityStatus(type, eventType), record);
        }

        LinkKnownRelationships(entities.Keys, links, record);
        return new TraceProjectionDelta(record, entities.Values.ToArray(), links.Values.ToArray());
    }

    private (string Json, bool Truncated) BuildDetails(object data)
    {
        JsonNode node = JsonSerializer.SerializeToNode(data, JsonOptions) ?? new JsonObject();
        Redact(node);
        var json = node.ToJsonString(JsonOptions);
        if (Encoding.UTF8.GetByteCount(json) <= _maxDetailsBytes) return (json, false);
        var bytes = Encoding.UTF8.GetBytes(json);
        var slice = Encoding.UTF8.GetString(bytes.AsSpan(0, Math.Max(0, _maxDetailsBytes - 32)));
        return (JsonSerializer.Serialize(new { truncated = true, preview = slice }), true);
    }

    private static IReadOnlyList<(string Type, string Id)> ExtractKnownIds(object data)
    {
        var properties = ScalarProperties.GetOrAdd(data.GetType(), static type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(p => KnownIds.Contains(p.Name) && p.GetIndexParameters().Length == 0)
            .ToArray());
        var ids = new List<(string, string)>();
        foreach (var property in properties)
        {
            var raw = property.GetValue(data);
            if (raw is null) continue;
            var id = FormatValue(raw);
            if (string.IsNullOrWhiteSpace(id)) continue;
            ids.Add((EntityTypeFor(property.Name), id));
        }
        return ids;
    }

    private static string EntityTypeFor(string name) => name switch
    {
        "RoleAgentId" or "TargetRoleAgentId" or "OwnerRoleAgentId" or "SelectedRoleAgentId" => "agent",
        "RoutingAttemptId" => "routing_attempt",
        "OfferId" => "intake_offer",
        "ClaimId" => "intake_claim",
        "PromptId" => "human_prompt",
        "ScheduleId" => ResourceKinds.Schedule,
        "ScheduleOccurrenceId" or "OccurrenceId" => "schedule_occurrence",
        "LlmRequestId" => "llm_request",
        "ArtifactId" or "ArtifactRevisionId" => ResourceKinds.Artifact,
        "MetadataRecordId" => "metadata_record",
        "SchemaId" or "SchemaVersion" or "SchemaRef" => "schema_validation",
        "ProviderFileId" or "ProviderFileKey" => "provider_file",
        "CommandId" => "command",
        "DeliveryId" => "delivery",
        "OperationKey" or "Key" => "operation",
        _ => "entity"
    };

    private static string EntityStatus(string type, string eventType)
    {
        if (type == "delivery")
        {
            if (eventType.Contains("Accepted", StringComparison.Ordinal)) return "accepted";
            if (eventType.Contains("Rejected", StringComparison.Ordinal)) return "rejected";
            if (eventType.Contains("Cancelled", StringComparison.Ordinal)) return "cancelled";
            if (eventType.Contains("Expired", StringComparison.Ordinal)) return "expired";
            if (eventType.Contains("Quarantined", StringComparison.Ordinal)) return "quarantined";
            return "pending";
        }
        if (type == "llm_request")
        {
            if (eventType.Contains("Succeeded", StringComparison.Ordinal)) return "succeeded";
            if (eventType.Contains("Failed", StringComparison.Ordinal) || eventType.Contains("Rejected", StringComparison.Ordinal)) return "failed";
            return "running";
        }
        if (type == ResourceKinds.Schedule && eventType.Contains("Cancelled", StringComparison.Ordinal)) return "cancelled";
        if (type == "schedule_occurrence" && eventType.Contains("Accepted", StringComparison.Ordinal)) return "accepted";
        return "active";
    }

    private static void AddStandard(IDictionary<(string, string), TraceEntityRecord> entities, IDictionary<string, TraceLinkRecord> links, string type, string id, string status, TraceEventRecord record)
    {
        AddEntity(entities, type, id, status, $"{type} {id}", record, record.DetailsJson);
        AddLink(links, type, id, "event", record.EventId, "observed_in", record);
        AddLink(links, "correlation", record.CorrelationId, type, id, "includes", record);
    }

    private static void AddEntity(IDictionary<(string, string), TraceEntityRecord> entities, string type, string id, string status, string summary, TraceEventRecord record, string detailsJson = "{}") =>
        entities[(type, id)] = new TraceEntityRecord(type, id, status, summary, record.EventId, record.OccurredAt, detailsJson);

    private static void AddLink(IDictionary<string, TraceLinkRecord> links, string fromType, string fromId, string toType, string toId, string linkType, TraceEventRecord record)
    {
        var key = $"{fromType}|{fromId}|{toType}|{toId}|{linkType}|{record.EventId}";
        links[key] = new TraceLinkRecord(fromType, fromId, toType, toId, linkType, record.EventId, record.OccurredAt);
    }

    private static void LinkKnownRelationships(IEnumerable<(string Type, string Id)> entityKeys, IDictionary<string, TraceLinkRecord> links, TraceEventRecord record)
    {
        var keys = entityKeys.ToArray();
        foreach (var from in keys)
            foreach (var to in keys)
            {
                if (from == to) continue;
                var link = (from.Type, to.Type) switch
                {
                    ("command", "delivery") => "created_delivery",
                    (ResourceKinds.Schedule, "schedule_occurrence") => "recorded_occurrence",
                    ("schedule_occurrence", "delivery") => "created_delivery",
                    ("operation", "llm_request") => "requested_llm",
                    ("agent", "operation") => "owns_operation",
                    ("routing_attempt", "intake_claim") => "selected_claim",
                    (ResourceKinds.Artifact, "metadata_record") => "produced_metadata",
                    ("schema_validation", "metadata_record") => "validated_metadata",
                    _ => null
                };
                if (link is not null) AddLink(links, from.Type, from.Id, to.Type, to.Id, link, record);
            }
    }

    private static string FormatValue(object value)
    {
        var valueProperty = value.GetType().GetProperty("Value", BindingFlags.Instance | BindingFlags.Public);
        if (valueProperty?.GetValue(value) is { } scalar) return scalar.ToString() ?? string.Empty;
        if (value.GetType().Name == "OperationKey")
        {
            var caller = value.GetType().GetProperty("Caller")?.GetValue(value);
            var request = value.GetType().GetProperty("RequestId")?.GetValue(value);
            var op = value.GetType().GetProperty("OperationType")?.GetValue(value);
            return $"{FormatValue(caller ?? "unknown")}/{FormatValue(request ?? "request")}/{op}";
        }
        return value.ToString() ?? string.Empty;
    }

    private static void Redact(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            foreach (var property in obj.ToArray())
            {
                if (SecretNames.Any(secret => property.Key.Contains(secret, StringComparison.OrdinalIgnoreCase))) obj[property.Key] = "[REDACTED]";
                else Redact(property.Value);
            }
        }
        else if (node is JsonArray array)
        {
            foreach (var item in array) Redact(item);
        }
    }
}