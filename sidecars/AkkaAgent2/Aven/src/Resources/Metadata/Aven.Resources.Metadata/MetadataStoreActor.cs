using Akka.Actor;
using Aven.ActorKernel;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Resources.Metadata;

public sealed class MetadataStoreActor : AvenPersistentActor
{
    private readonly Func<SchemaRef, string, MetadataValidationResult>? _validator;
    private readonly CanonicalJsonSerializer _serializer = new();
    private readonly Dictionary<OperationKey, MetadataReceipt> _receipts = new();
    private readonly List<MetadataRecord> _records = new();

    public MetadataStoreActor(
        string persistenceId,
        Func<SchemaRef, string, MetadataValidationResult>? validator = null)
    {
        PersistenceId = persistenceId;
        _validator = validator;

        Command<MetadataCreateCommand>(command => HandleCreate(command.Request));
        Command<MetadataQueryCommand>(command => Sender.Tell(QueryInternal(command.Query)));
        Command<MetadataInspectAll>(_ => Sender.Tell(_records.ToArray()));

        RecoverEvent<MetadataRecordCreated>(Apply);
    }

    public override string PersistenceId { get; }

    private void HandleCreate(MetadataCreateRequest request)
        => HandleCreateAfterAdmission(request, Sender);

    private void HandleCreateAfterAdmission(MetadataCreateRequest request, IActorRef replyTo)
    {

        var payloadHash = ComputeRequestHash(request);
        if (_receipts.TryGetValue(request.Key, out var receipt))
        {
            if (StringComparer.Ordinal.Equals(receipt.PayloadHash, payloadHash))
            {
                replyTo.Tell(new MetadataCreateSucceeded(request.Key, request.CorrelationId, receipt.Record, true));
                return;
            }

            replyTo.Tell(new MetadataCreateConflict(
                request.Key,
                request.CorrelationId,
                new OperationError("metadata_conflict", "OperationKey was already used for different metadata content.", false)));
            return;
        }

        var validation = _validator?.Invoke(request.SchemaRef, request.Json) ?? MetadataValidationResult.Success;
        if (!validation.Succeeded)
        {
            replyTo.Tell(new MetadataCreateRejected(
                request.Key,
                request.CorrelationId,
                new OperationError(
                    "metadata_schema_validation_failed",
                    string.Join("; ", validation.Errors),
                    false)));
            return;
        }

        var record = new MetadataRecord(
            RecordId: $"meta-{_records.Count + 1}",
            Subject: request.Subject,
            SchemaRef: request.SchemaRef,
            Json: request.Json,
            PayloadHash: payloadHash,
            CreatedAt: DateTimeOffset.UtcNow,
            SourceSummary: request.SourceSummary);

        var evt = new MetadataRecordCreated(
            record.RecordId,
            request.Key,
            request.CorrelationId,
            record.Subject.Kind,
            record.Subject.Id,
            record.Subject.ArtifactId is null ? null : new ArtifactId(record.Subject.ArtifactId.Value.Value),
            record.Subject.ArtifactRevisionId is null ? null : new ArtifactRevisionId(record.Subject.ArtifactRevisionId.Value.Value),
            record.Subject.RoleAgentId is null ? null : new RoleAgentId(record.Subject.RoleAgentId.Value.Value),
            record.Subject.PromptId is null ? null : new PromptId(record.Subject.PromptId.Value.Value),
            record.Subject.ExternalSourceId,
            record.SchemaRef,
            record.Json,
            record.PayloadHash,
            record.SourceSummary,
            record.CreatedAt);
        PersistEvent(evt, MetadataFor<MetadataRecordCreated>(
            new ActorAddress("resource/metadata/store", "local"),
            nameof(MetadataStoreActor),
            request.CorrelationId,
            evt,
            operationKey: request.Key,
            occurredAt: record.CreatedAt), e =>
        {
            Apply(e);
            replyTo.Tell(new MetadataCreateSucceeded(request.Key, request.CorrelationId, CreateRecord(e), false));
        });
    }

    private MetadataQueryResult QueryInternal(MetadataQuery query)
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

    private void Apply(MetadataRecordCreated created)
    {
        var record = CreateRecord(created);
        _records.Add(record);
        _receipts[created.Key] = new MetadataReceipt(created.PayloadHash, record);
    }

    private static MetadataRecord CreateRecord(MetadataRecordCreated created) => new(
        created.RecordId,
        new MetadataSubject(
            created.SubjectKind,
            created.SubjectId,
            created.ArtifactId is null ? (Aven.Toolkit.Core.Identifiers.ArtifactId?)null : new Aven.Toolkit.Core.Identifiers.ArtifactId(created.ArtifactId.Value.Value),
            created.ArtifactRevisionId is null ? (Aven.Toolkit.Core.Identifiers.ArtifactRevisionId?)null : new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId(created.ArtifactRevisionId.Value.Value),
            created.RoleAgentId is null ? (Aven.Toolkit.Core.Identifiers.RoleAgentId?)null : new Aven.Toolkit.Core.Identifiers.RoleAgentId(created.RoleAgentId.Value.Value),
            created.PromptId is null ? (Aven.Toolkit.Core.Identifiers.PromptId?)null : new Aven.Toolkit.Core.Identifiers.PromptId(created.PromptId.Value.Value),
            created.ExternalSourceId),
        created.SchemaRef,
        created.Json,
        created.PayloadHash,
        created.CreatedAt,
        created.SourceSummary);

    private string ComputeRequestHash(MetadataCreateRequest request) => string.Join(
        "|",
        request.Subject.Kind,
        request.Subject.Id,
        request.SchemaRef.Value,
        _serializer.HashJson(request.Json),
        request.SourceSummary ?? string.Empty);

    private sealed record MetadataReceipt(string PayloadHash, MetadataRecord Record);
}