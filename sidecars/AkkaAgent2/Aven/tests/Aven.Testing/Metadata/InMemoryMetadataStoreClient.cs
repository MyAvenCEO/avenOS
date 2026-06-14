using Aven.Toolkit.Core.Serialization;

namespace Aven.Resources.Metadata;

public sealed class InMemoryMetadataStoreClient : IMetadataStoreClient
{
    private readonly Func<SchemaRef, string, MetadataValidationResult> _validator;
    private readonly CanonicalJsonSerializer _serializer = new();
    private readonly Dictionary<OperationKey, MetadataReceipt> _receipts = new();
    private readonly List<MetadataRecord> _records = new();
    private readonly ICapabilityAdmissionClient? _capabilityAuthority;
    private readonly ActorAddress _capabilityTarget;

    public InMemoryMetadataStoreClient(
        Func<SchemaRef, string, MetadataValidationResult> validator,
        ICapabilityAdmissionClient? capabilityAuthority = null,
        ActorAddress? capabilityTarget = null)
    {
        _validator = validator;
        _capabilityAuthority = capabilityAuthority;
        _capabilityTarget = capabilityTarget ?? new ActorAddress("resource/metadata", "local");
    }

    public MetadataCreateReply Create(MetadataCreateRequest request)
    {
        if (_capabilityAuthority is not null)
        {
            if (request.CapabilityId is not { } capabilityId)
            {
                return new MetadataCreateRejected(
                    request.Key,
                    request.CorrelationId,
                    new OperationError("capability_required", "Metadata writes require a capability id.", false));
            }

            var admission = _capabilityAuthority.Admit(new CapabilityAdmissionRequest(
                capabilityId,
                request.Key,
                _capabilityTarget,
                "metadata.create",
                DateTimeOffset.UtcNow));
            if (admission is CapabilityRejected rejected)
            {
                return new MetadataCreateRejected(request.Key, request.CorrelationId, rejected.Error);
            }
        }

        var payloadHash = ComputeRequestHash(request);
        if (_receipts.TryGetValue(request.Key, out var receipt))
        {
            if (StringComparer.Ordinal.Equals(receipt.PayloadHash, payloadHash))
            {
                return new MetadataCreateSucceeded(request.Key, request.CorrelationId, receipt.Record, true);
            }

            return new MetadataCreateConflict(
                request.Key,
                request.CorrelationId,
                new OperationError("metadata_conflict", "OperationKey was already used for different metadata content.", false));
        }

        var validation = _validator(request.SchemaRef, request.Json);
        if (!validation.Succeeded)
        {
            return new MetadataCreateRejected(
                request.Key,
                request.CorrelationId,
                new OperationError(
                    "metadata_schema_validation_failed",
                    string.Join("; ", validation.Errors),
                    false));
        }

        var record = new MetadataRecord(
            RecordId: $"meta-{_records.Count + 1}",
            Subject: request.Subject,
            SchemaRef: request.SchemaRef,
            Json: request.Json,
            PayloadHash: payloadHash,
            CreatedAt: DateTimeOffset.UtcNow,
            SourceSummary: request.SourceSummary);

        _records.Add(record);
        _receipts[request.Key] = new MetadataReceipt(payloadHash, record);
        return new MetadataCreateSucceeded(request.Key, request.CorrelationId, record, false);
    }

    public MetadataQueryResult Query(MetadataQuery query)
    {
        var appliedLimit = Math.Clamp(query.Limit, 1, 500);
        var timeout = query.Timeout ?? TimeSpan.FromSeconds(1);
        var deadline = DateTime.UtcNow + timeout;
        var results = new List<MetadataRecord>(appliedLimit);
        var subjectKinds = query.SubjectKinds?.Where(static x => !string.IsNullOrWhiteSpace(x)).ToHashSet(StringComparer.Ordinal);
        var subjectIds = query.SubjectIds?.Where(static x => !string.IsNullOrWhiteSpace(x)).ToHashSet(StringComparer.Ordinal);
        var schemaRefs = query.SchemaRefs?.ToHashSet();

        foreach (var record in _records)
        {
            if (DateTime.UtcNow > deadline)
            {
                return new MetadataQueryResult(results, true, appliedLimit);
            }

            if (query.SubjectKind is not null && !StringComparer.Ordinal.Equals(query.SubjectKind, record.Subject.Kind))
            {
                continue;
            }

            if (subjectKinds is { Count: > 0 } && !subjectKinds.Contains(record.Subject.Kind))
            {
                continue;
            }

            if (query.SubjectId is not null && !StringComparer.Ordinal.Equals(query.SubjectId, record.Subject.Id))
            {
                continue;
            }

            if (subjectIds is { Count: > 0 } && !subjectIds.Contains(record.Subject.Id))
            {
                continue;
            }

            if (query.SchemaRef is not null && query.SchemaRef != record.SchemaRef)
            {
                continue;
            }

            if (schemaRefs is { Count: > 0 } && !schemaRefs.Contains(record.SchemaRef))
            {
                continue;
            }

            results.Add(record);
            if (results.Count >= appliedLimit)
            {
                break;
            }
        }

        return new MetadataQueryResult(results, false, appliedLimit);
    }

    public IReadOnlyList<MetadataRecord> InspectAll() =>
        _records.ToArray();

    private string ComputeRequestHash(MetadataCreateRequest request) => string.Join(
        "|",
        request.Subject.Kind,
        request.Subject.Id,
        request.SchemaRef.Value,
        _serializer.HashJson(request.Json),
        request.SourceSummary ?? string.Empty);

    private sealed record MetadataReceipt(string PayloadHash, MetadataRecord Record);
}