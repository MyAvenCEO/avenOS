using System.Text.Json;
using Akka.Actor;
using Aven.Capabilities.Contracts.Responses;
using Aven.Resources.Metadata.Contracts;
using Aven.Resources.Metadata.Workers;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Metadata.Gateways;

using MetadataStarted = ResourceGatewayRail<MetadataWriteOperationPayload>.Started;
using MetadataRecovered = ResourceGatewayRail<MetadataWriteOperationPayload>.Recovered;
using MetadataCapabilityGateResult = ResourceGatewayRail<MetadataWriteOperationPayload>.CapabilityGateResult;
using MetadataRecoveryPrepared = ResourceGatewayRail<MetadataWriteOperationPayload>.RecoveryPrepared;
using MetadataStoreCommandFailed = ResourceGatewayRail<MetadataWriteOperationPayload>.StoreCommandFailed;
using MetadataQueryStarted = ResourceGatewayRail<MetadataQueryOperationPayload>.Started;
using MetadataQueryRecovered = ResourceGatewayRail<MetadataQueryOperationPayload>.Recovered;
using MetadataQueryCapabilityGateResult = ResourceGatewayRail<MetadataQueryOperationPayload>.CapabilityGateResult;
using MetadataQueryRecoveryPrepared = ResourceGatewayRail<MetadataQueryOperationPayload>.RecoveryPrepared;
using MetadataQueryStoreCommandFailed = ResourceGatewayRail<MetadataQueryOperationPayload>.StoreCommandFailed;


public sealed record MetadataGatewayQueryCommand(MetadataQuery Query);

public sealed record MetadataGatewayInspectAllCommand;

public abstract record MetadataGatewayReadReply;

public sealed record MetadataGatewayQuerySucceeded(MetadataQueryResult Result)
    : MetadataGatewayReadReply;

public sealed record MetadataGatewayInspectAllSucceeded(MetadataRecord[] Records)
    : MetadataGatewayReadReply;

public sealed record MetadataGatewayReadFailed(OperationError Error)
    : MetadataGatewayReadReply;

public sealed class MetadataGatewayActor : ReceiveActor
{
    private static readonly ActorAddress ResourceAddress = ResourceAddresses.Gateway(ResourceKinds.Metadata);
    private static readonly ActorAddress WorkerAddress = ResourceAddresses.Worker(ResourceKinds.Metadata);

    private static readonly ResourceOperationDescriptor<MetadataWriteOperationPayload> Descriptor = new(
        ResourceKinds.Metadata,
        static _ => ResourceOperationTypes.MetadataCreate,
        (sender, payload) => new OperationKey(sender, new RequestId(payload.RequestId), ResourceOperationTypes.MetadataCreate),
        payload => string.IsNullOrWhiteSpace(payload.CapabilityId) ? null : new CapabilityId(payload.CapabilityId),
        payload => string.IsNullOrWhiteSpace(payload.RequestId)
            ? ValidationResult.Failure("invalid_metadata_payload", "Metadata requestId is required.")
            : string.IsNullOrWhiteSpace(payload.SubjectKind)
                ? ValidationResult.Failure("invalid_metadata_payload", "Metadata subject kind is required.")
                : string.IsNullOrWhiteSpace(payload.SubjectId)
                    ? ValidationResult.Failure("invalid_metadata_payload", "Metadata subject id is required.")
                    : string.IsNullOrWhiteSpace(payload.Json)
                        ? ValidationResult.Failure("invalid_metadata_payload", "Metadata json payload is required.")
                        : ValidationResult.Success);

    private static readonly ResourceOperationDescriptor<MetadataQueryOperationPayload> QueryDescriptor = new(
        ResourceKinds.Metadata,
        static _ => ResourceOperationTypes.MetadataQuery,
        (sender, payload) => new OperationKey(sender, new RequestId(payload.RequestId), ResourceOperationTypes.MetadataQuery),
        payload => string.IsNullOrWhiteSpace(payload.CapabilityId) ? null : new CapabilityId(payload.CapabilityId),
        payload => string.IsNullOrWhiteSpace(payload.RequestId)
            ? ValidationResult.Failure("invalid_metadata_payload", "Metadata query requestId is required.")
            : payload.Limit <= 0
                ? ValidationResult.Failure("invalid_metadata_payload", "Metadata query limit must be greater than zero.")
                : payload.TimeoutMilliseconds <= 0
                    ? ValidationResult.Failure("invalid_metadata_payload", "Metadata query timeout must be greater than zero.")
                    : ValidationResult.Success);

    private sealed record MetadataWriteCapabilityCompleted(MetadataStarted Started, object Admission);
    private sealed record MetadataWriteCapabilityErrored(MetadataStarted Started, Exception Exception);
    private sealed record StartMetadataWrite(MetadataStarted Started);
    private sealed record StartRecoveredMetadataWrite(MetadataRecovered Recovered);
    private sealed record RecoverableMetadataWriteOperationsLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);
    private sealed record MetadataRecoveryPreparedMessage(MetadataRecoveryPrepared Prepared);

    private sealed record MetadataQueryCapabilityCompleted(MetadataQueryStarted Started, object Admission);
    private sealed record MetadataQueryCapabilityErrored(MetadataQueryStarted Started, Exception Exception);
    private sealed record StartMetadataQuery(MetadataQueryStarted Started);
    private sealed record StartRecoveredMetadataQuery(MetadataQueryRecovered Recovered);
    private sealed record RecoverableMetadataQueryOperationsLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);
    private sealed record MetadataQueryRecoveryPreparedMessage(MetadataQueryRecoveryPrepared Prepared);

    private readonly ResourceGatewayRail<MetadataWriteOperationPayload> _rail;
    private readonly ResourceGatewayRail<MetadataQueryOperationPayload> _queryRail;
    private readonly IActorRef _metadataActor;
    private readonly IActorRef? _schemaRegistryActor;
    private IActorRef? _metadataWriter;

    public MetadataGatewayActor(
        IActorRef metadataActor,
        IActorAddressResolver resolver,
        IResourceOperationInboxStore inboxStore,
        ICapabilityAdmissionClient? capabilityAuthority = null,
        IActorRef? schemaRegistryActor = null)
    {
        _metadataActor = metadataActor;
        _schemaRegistryActor = schemaRegistryActor;
        _rail = new ResourceGatewayRail<MetadataWriteOperationPayload>(Self, resolver, inboxStore, capabilityAuthority);
        _queryRail = new ResourceGatewayRail<MetadataQueryOperationPayload>(Self, resolver, inboxStore, capabilityAuthority);

        Receive<MetadataWriteWorkerActor.StartedCompleted>(HandleMetadataWriteCompleted);
        Receive<MetadataWriteWorkerActor.StartedErrored>(failed =>
            _rail.FailOperation(failed.Started, ResourceAddress, WorkerAddress, "metadata_write_failed", failed.Exception.Message, true));
        Receive<MetadataWriteWorkerActor.RecoveredCompleted>(HandleRecoveredMetadataWriteCompleted);
        Receive<MetadataWriteWorkerActor.RecoveredErrored>(failed =>
            _rail.FailRecovered(failed.Recovered, ResourceAddress, WorkerAddress, "metadata_write_failed", failed.Exception.Message, true));
        Receive<MetadataWriteCapabilityCompleted>(HandleMetadataWriteCapabilityCompleted);
        Receive<MetadataWriteCapabilityErrored>(errored =>
            _rail.Reject(errored.Started.DeliverySender, errored.Started.Offer, new OperationError("capability_admission_failed", errored.Exception.Message, true)));
        Receive<ResourceGatewayRail<MetadataWriteOperationPayload>.RejectRecordedIntentMessage<MetadataWriteOperationPayload>>(_rail.HandleRejectedRecordedIntent);
        Receive<StartMetadataWrite>(message => StartMetadataWriteAsync(message.Started));
        Receive<StartRecoveredMetadataWrite>(message => StartMetadataWriteAsync(message.Recovered));
        Receive<RecoverableMetadataWriteOperationsLoaded>(loaded => _rail.PrepareRecoveryBatch(loaded.Records, "invalid_metadata_payload", prepared => new MetadataRecoveryPreparedMessage(prepared)));
        Receive<MetadataRecoveryPreparedMessage>(message =>
        {
            var next = _rail.HandlePreparedRecovery(message.Prepared, recovered => new StartRecoveredMetadataWrite(recovered));
            if (next is ResourceGatewayRail<MetadataWriteOperationPayload>.MarkProcessingMessage<MetadataWriteOperationPayload> markProcessing)
            {
                _rail.HandleMarkProcessing(markProcessing);
            }
        });
        Receive<ResourceGatewayRail<MetadataWriteOperationPayload>.MarkProcessingMessage<MetadataWriteOperationPayload>>(_rail.HandleMarkProcessing);
        Receive<MetadataStoreCommandFailed>(_rail.HandleStoreCommandFailed);

        Receive<MetadataQueryWorkerActor.StartedCompleted>(HandleMetadataQueryCompleted);
        Receive<MetadataQueryWorkerActor.StartedErrored>(failed =>
            _queryRail.FailOperation(failed.Started, ResourceAddress, WorkerAddress, "metadata_query_failed", failed.Exception.Message, true));
        Receive<MetadataQueryWorkerActor.RecoveredCompleted>(HandleRecoveredMetadataQueryCompleted);
        Receive<MetadataQueryWorkerActor.RecoveredErrored>(failed =>
            _queryRail.FailRecovered(failed.Recovered, ResourceAddress, WorkerAddress, "metadata_query_failed", failed.Exception.Message, true));
        Receive<MetadataQueryCapabilityCompleted>(HandleMetadataQueryCapabilityCompleted);
        Receive<MetadataQueryCapabilityErrored>(errored =>
            _queryRail.Reject(errored.Started.DeliverySender, errored.Started.Offer, new OperationError("capability_admission_failed", errored.Exception.Message, true)));
        Receive<ResourceGatewayRail<MetadataQueryOperationPayload>.RejectRecordedIntentMessage<MetadataQueryOperationPayload>>(_queryRail.HandleRejectedRecordedIntent);
        Receive<StartMetadataQuery>(message => StartMetadataQueryAsync(message.Started));
        Receive<StartRecoveredMetadataQuery>(message => StartMetadataQueryAsync(message.Recovered));
        Receive<RecoverableMetadataQueryOperationsLoaded>(loaded => _queryRail.PrepareRecoveryBatch(loaded.Records, "invalid_metadata_payload", prepared => new MetadataQueryRecoveryPreparedMessage(prepared)));
        Receive<MetadataQueryRecoveryPreparedMessage>(message =>
        {
            var next = _queryRail.HandlePreparedRecovery(message.Prepared, recovered => new StartRecoveredMetadataQuery(recovered));
            if (next is ResourceGatewayRail<MetadataQueryOperationPayload>.MarkProcessingMessage<MetadataQueryOperationPayload> markProcessing)
            {
                _queryRail.HandleMarkProcessing(markProcessing);
            }
        });
        Receive<ResourceGatewayRail<MetadataQueryOperationPayload>.MarkProcessingMessage<MetadataQueryOperationPayload>>(_queryRail.HandleMarkProcessing);
        Receive<MetadataQueryStoreCommandFailed>(_queryRail.HandleStoreCommandFailed);
        Receive<MetadataGatewayQueryCommand>(HandleDirectQueryCommand);
        Receive<MetadataGatewayInspectAllCommand>(HandleDirectInspectAllCommand);
        Receive<MetadataReadWorkerActor.QueryCompleted>(message =>
            message.ReplyTo.Tell(new MetadataGatewayQuerySucceeded(message.Result), Self));
        Receive<MetadataReadWorkerActor.QueryErrored>(message =>
            message.ReplyTo.Tell(new MetadataGatewayReadFailed(new OperationError("metadata_query_failed", message.Exception.Message, true)), Self));
        Receive<MetadataReadWorkerActor.InspectAllCompleted>(message =>
            message.ReplyTo.Tell(new MetadataGatewayInspectAllSucceeded(message.Records), Self));
        Receive<MetadataReadWorkerActor.InspectAllErrored>(message =>
            message.ReplyTo.Tell(new MetadataGatewayReadFailed(new OperationError("metadata_inspect_failed", message.Exception.Message, true)), Self));

        Receive<DeliveryAttemptOffer>(HandleOffer);
        Receive<RecoverResourceOperations>(_ => RecoverPendingOperations());
    }

    private void HandleDirectQueryCommand(MetadataGatewayQueryCommand command)
    {
        var replyTo = Sender;
        var worker = Context.ActorOf(
            Props.Create(() => new MetadataReadWorkerActor(_metadataActor, Self)),
            $"metadata-read-worker-{Guid.NewGuid():N}");
        worker.Tell(new MetadataReadWorkerActor.ExecuteQuery(command, replyTo), Self);
    }

    private void HandleDirectInspectAllCommand(MetadataGatewayInspectAllCommand command)
    {
        var replyTo = Sender;
        var worker = Context.ActorOf(
            Props.Create(() => new MetadataReadWorkerActor(_metadataActor, Self)),
            $"metadata-read-worker-{Guid.NewGuid():N}");
        worker.Tell(new MetadataReadWorkerActor.ExecuteInspectAll(command, replyTo), Self);
    }

    protected override void PreStart()
    {
        RecoverPendingOperations();
        base.PreStart();
    }

    private void HandleOffer(DeliveryAttemptOffer offer)
    {
        if (string.Equals(offer.Envelope.MessageType, ResourceOperationTypes.MetadataCreate, StringComparison.Ordinal))
        {
            HandleWriteOffer(offer);
            return;
        }

        if (string.Equals(offer.Envelope.MessageType, ResourceOperationTypes.MetadataQuery, StringComparison.Ordinal))
        {
            HandleQueryOffer(offer);
            return;
        }

        _rail.Reject(
            Sender,
            offer,
            new OperationError("unsupported_operation_type", $"Envelope message type '{offer.Envelope.MessageType}' is not supported for metadata operations.", false));
    }

    private void HandleWriteOffer(DeliveryAttemptOffer offer)
    {
        if (!_rail.TryStart(
                offer,
                Sender,
                Descriptor,
                "invalid_metadata_payload",
                "Unsupported metadata plan payload.",
                out var started)
            || started is null)
        {
            return;
        }

        if (!_rail.TryResolveCapabilityId(started, Descriptor.PayloadCapabilityId(started.Payload)?.Value, "metadata operation", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _rail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "Metadata capability id could not be resolved.", false));
            return;
        }

        var gateResult = _rail.StartCapabilityGate(
            resolvedStarted,
            resolvedStarted.InboxRecord.ResolvedCapabilityId,
            ResourceAddress,
            ResourceOperationTypes.MetadataCreate,
            attributes: null,
            admission => new MetadataWriteCapabilityCompleted(resolvedStarted, admission),
            ex => new MetadataWriteCapabilityErrored(resolvedStarted, ex));

        if (gateResult == MetadataCapabilityGateResult.Stopped)
        {
            return;
        }

        ContinueAfterRecording(resolvedStarted);
    }

    private void HandleQueryOffer(DeliveryAttemptOffer offer)
    {
        if (!_queryRail.TryStart(
                offer,
                Sender,
                QueryDescriptor,
                "invalid_metadata_payload",
                "Unsupported metadata query payload.",
                out var started)
            || started is null)
        {
            return;
        }

        if (!_queryRail.TryResolveCapabilityId(started, QueryDescriptor.PayloadCapabilityId(started.Payload)?.Value, "metadata query", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _queryRail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "Metadata query capability id could not be resolved.", false));
            return;
        }

        var gateResult = _queryRail.StartCapabilityGate(
            resolvedStarted,
            resolvedStarted.InboxRecord.ResolvedCapabilityId,
            ResourceAddress,
            ResourceOperationTypes.MetadataQuery,
            attributes: null,
            admission => new MetadataQueryCapabilityCompleted(resolvedStarted, admission),
            ex => new MetadataQueryCapabilityErrored(resolvedStarted, ex));

        if (gateResult == MetadataQueryCapabilityGateResult.Stopped)
        {
            return;
        }

        ContinueAfterRecording(resolvedStarted);
    }

    private void ContinueAfterRecording(MetadataStarted started)
        => _rail.ContinueAfterRecordingAsync(started, pending => new StartMetadataWrite(pending));

    private void ContinueAfterRecording(MetadataQueryStarted started)
        => _queryRail.ContinueAfterRecordingAsync(started, pending => new StartMetadataQuery(pending));

    private void HandleMetadataWriteCapabilityCompleted(MetadataWriteCapabilityCompleted completed)
    {
        if (completed.Admission is CapabilityRejected rejected)
        {
            _rail.Reject(completed.Started.DeliverySender, completed.Started.Offer, rejected.Error);
            return;
        }

        ContinueAfterRecording(completed.Started);
    }

    private void HandleMetadataQueryCapabilityCompleted(MetadataQueryCapabilityCompleted completed)
    {
        if (completed.Admission is CapabilityRejected rejected)
        {
            _queryRail.Reject(completed.Started.DeliverySender, completed.Started.Offer, rejected.Error);
            return;
        }

        ContinueAfterRecording(completed.Started);
    }

    private void StartMetadataWriteAsync(MetadataStarted started)
        => EnsureMetadataWriter().Tell(new MetadataWriteWorkerActor.ExecuteStarted(started), Self);

    private void StartMetadataWriteAsync(MetadataRecovered recovered)
        => EnsureMetadataWriter().Tell(new MetadataWriteWorkerActor.ExecuteRecovered(recovered), Self);

    private void StartMetadataQueryAsync(MetadataQueryStarted started)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new MetadataQueryWorkerActor(_metadataActor, Self)),
            $"metadata-query-worker-{Guid.NewGuid():N}");
        worker.Tell(new MetadataQueryWorkerActor.ExecuteStarted(started), Self);
    }

    private void StartMetadataQueryAsync(MetadataQueryRecovered recovered)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new MetadataQueryWorkerActor(_metadataActor, Self)),
            $"metadata-query-worker-{Guid.NewGuid():N}");
        worker.Tell(new MetadataQueryWorkerActor.ExecuteRecovered(recovered), Self);
    }

    private IActorRef EnsureMetadataWriter()
    {
        if (_metadataWriter is not null)
        {
            return _metadataWriter;
        }

        _metadataWriter = Context.ActorOf(
            Props.Create(() => new MetadataWriteWorkerActor(_metadataActor, _schemaRegistryActor, Self)),
            "metadata-writer");
        return _metadataWriter;
    }

    private void HandleMetadataWriteCompleted(MetadataWriteWorkerActor.StartedCompleted completed)
    {
        if (completed.Reply is not MetadataCreateSucceeded succeeded)
        {
            var error = completed.Reply switch
            {
                MetadataCreateRejected rejected => rejected.Error,
                MetadataCreateConflict conflict => conflict.Error,
                _ => new OperationError("metadata_write_failed", $"Unexpected metadata reply {completed.Reply.GetType().Name}", false)
            };
            _rail.FailOperation(completed.Started, ResourceAddress, WorkerAddress, error.Code, error.Message, error.Retryable);
            return;
        }

        _rail.Resolve(
            completed.Started,
            ResourceOperationTypes.MetadataCreate,
            JsonSerializer.Serialize(new { recordId = succeeded.Record.RecordId }),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleRecoveredMetadataWriteCompleted(MetadataWriteWorkerActor.RecoveredCompleted completed)
    {
        if (completed.Reply is not MetadataCreateSucceeded succeeded)
        {
            var error = completed.Reply switch
            {
                MetadataCreateRejected rejected => rejected.Error,
                MetadataCreateConflict conflict => conflict.Error,
                _ => new OperationError("metadata_write_failed", $"Unexpected metadata reply {completed.Reply.GetType().Name}", false)
            };
            _rail.FailRecovered(completed.Recovered, ResourceAddress, WorkerAddress, error.Code, error.Message, error.Retryable);
            return;
        }

        _rail.ResolveRecovered(
            completed.Recovered,
            ResourceOperationTypes.MetadataCreate,
            JsonSerializer.Serialize(new { recordId = succeeded.Record.RecordId }),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleMetadataQueryCompleted(MetadataQueryWorkerActor.StartedCompleted completed)
    {
        _queryRail.Resolve(
            completed.Started,
            ResourceOperationTypes.MetadataQuery,
            JsonSerializer.Serialize(ToQueryOperationResult(completed.Result)),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleRecoveredMetadataQueryCompleted(MetadataQueryWorkerActor.RecoveredCompleted completed)
    {
        _queryRail.ResolveRecovered(
            completed.Recovered,
            ResourceOperationTypes.MetadataQuery,
            JsonSerializer.Serialize(ToQueryOperationResult(completed.Result)),
            ResourceAddress,
            WorkerAddress);
    }

    private static MetadataQueryOperationResult ToQueryOperationResult(MetadataQueryResult result) =>
        new(
            result.Records.Select(static record => new MetadataRecordSnapshot(
                record.RecordId,
                record.Subject.Kind,
                record.Subject.Id,
                record.Subject.ArtifactId?.Value,
                record.Subject.ArtifactRevisionId?.Value,
                record.SchemaRef.Value,
                record.Json,
                record.PayloadHash,
                record.CreatedAt,
                record.SourceSummary)).ToArray(),
            result.TimedOut,
            result.AppliedLimit);

    private void RecoverPendingOperations()
    {
        _rail.ListRecoverableAsync(
            ResourceKinds.Metadata,
            static records => new RecoverableMetadataWriteOperationsLoaded(records.Where(static x => string.Equals(x.OperationType, ResourceOperationTypes.MetadataCreate, StringComparison.Ordinal)).ToArray()),
            ex => new MetadataStoreCommandFailed("list_recoverable", ResourceKinds.Metadata, ex));

        _queryRail.ListRecoverableAsync(
            ResourceKinds.Metadata,
            static records => new RecoverableMetadataQueryOperationsLoaded(records.Where(static x => string.Equals(x.OperationType, ResourceOperationTypes.MetadataQuery, StringComparison.Ordinal)).ToArray()),
            ex => new MetadataQueryStoreCommandFailed("list_recoverable", ResourceKinds.Metadata, ex));
    }
}
