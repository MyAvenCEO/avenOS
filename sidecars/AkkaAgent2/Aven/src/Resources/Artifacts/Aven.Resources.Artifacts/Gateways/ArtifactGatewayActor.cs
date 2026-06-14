using System.Text;
using System.Text.Json;
using Akka.Actor;
using Microsoft.Data.Sqlite;
using Aven.Capabilities.Contracts.Models;
using Aven.Capabilities.Contracts.Responses;
using Aven.Resources.Artifacts.Workers;
using Aven.Resources.Runtime.Gateways;
using ArtifactWriteOperationPayload = Aven.Resources.Artifacts.Contracts.ArtifactWriteOperationPayload;
using ArtifactWriteOperationResult = Aven.Resources.Artifacts.Contracts.ArtifactWriteOperationResult;

namespace Aven.Resources.Artifacts.Gateways;

using ArtifactStarted = ResourceGatewayRail<ArtifactWriteOperationPayload>.Started;
using ArtifactRecovered = ResourceGatewayRail<ArtifactWriteOperationPayload>.Recovered;
using ArtifactCapabilityGateResult = ResourceGatewayRail<ArtifactWriteOperationPayload>.CapabilityGateResult;
using ArtifactRecoveryPrepared = ResourceGatewayRail<ArtifactWriteOperationPayload>.RecoveryPrepared;
using ArtifactStoreCommandFailed = ResourceGatewayRail<ArtifactWriteOperationPayload>.StoreCommandFailed;

public sealed record ArtifactGatewayUploadCommand(
    RequestId RequestId,
    ActorAddress Caller,
    CorrelationId CorrelationId,
    string Filename,
    string MimeType,
    string SourceKind,
    byte[] Content,
    string? Description,
    CapabilityId? CapabilityId);

public abstract record ArtifactGatewayUploadReply;

public sealed record ArtifactGatewayUploadSucceeded(ArtifactWriteOperationResult Result)
    : ArtifactGatewayUploadReply;

public sealed record ArtifactGatewayUploadRejected(OperationError Error)
    : ArtifactGatewayUploadReply;

public sealed record ArtifactGatewayUploadFailed(OperationError Error)
    : ArtifactGatewayUploadReply;


public sealed record ArtifactGatewayReadCommand(ArtifactId ArtifactId);

public abstract record ArtifactGatewayReadReply;

public sealed record ArtifactGatewayReadSucceeded(ArtifactDescriptor Artifact)
    : ArtifactGatewayReadReply;

public sealed record ArtifactGatewayReadNotFound(ArtifactId ArtifactId)
    : ArtifactGatewayReadReply;

public sealed record ArtifactGatewayReadFailed(OperationError Error)
    : ArtifactGatewayReadReply;

public sealed record ArtifactGatewayQueryCommand(
    string? FilenameContains,
    string? MimeType,
    string? SourceKind,
    int? Limit);

public abstract record ArtifactGatewayQueryReply;

public sealed record ArtifactGatewayQuerySucceeded(IReadOnlyList<ArtifactDescriptor> Artifacts)
    : ArtifactGatewayQueryReply;

public sealed record ArtifactGatewayQueryFailed(OperationError Error)
    : ArtifactGatewayQueryReply;

public sealed class ArtifactGatewayActor : ReceiveActor
{
    private static readonly ActorAddress CapabilityTarget = ResourceAddresses.Gateway(ResourceKinds.Artifact);
    private static readonly ActorAddress ResourceAddress = ResourceAddresses.Gateway(ResourceKinds.Artifact);
    private static readonly ActorAddress WorkerAddress = ResourceAddresses.Worker(ResourceKinds.Artifact);
    private static readonly ResourceOperationDescriptor<ArtifactWriteOperationPayload> Descriptor = new(
        ResourceKinds.Artifact,
        payload => payload.Append ? ResourceOperationTypes.ArtifactAppend : ResourceOperationTypes.ArtifactCreate,
        (sender, payload) => new OperationKey(
            sender,
            new RequestId(payload.RequestId),
            payload.Append ? ResourceOperationTypes.ArtifactAppend : ResourceOperationTypes.ArtifactCreate),
        payload => string.IsNullOrWhiteSpace(payload.CapabilityId) ? null : new CapabilityId(payload.CapabilityId),
        payload => string.IsNullOrWhiteSpace(payload.RequestId)
            ? ValidationResult.Failure("invalid_artifact_payload", "Artifact requestId is required.")
            : string.IsNullOrWhiteSpace(payload.Filename)
                ? ValidationResult.Failure("invalid_artifact_payload", "Artifact filename is required.")
                : string.IsNullOrWhiteSpace(payload.MimeType)
                    ? ValidationResult.Failure("invalid_artifact_payload", "Artifact mimeType is required.")
                    : string.IsNullOrWhiteSpace(payload.SourceKind)
                        ? ValidationResult.Failure("invalid_artifact_payload", "Artifact source kind is required.")
                        : string.IsNullOrWhiteSpace(payload.Content)
                            ? ValidationResult.Failure("invalid_artifact_payload", "Artifact content is required.")
                            : payload.Append && payload.ArtifactId is null
                                ? ValidationResult.Failure("invalid_artifact_payload", "artifactId is required when append=true.")
                                : ValidationResult.Success);

    private sealed record ArtifactCapabilityCompleted(ArtifactStarted Started, object Admission);
    private sealed record ArtifactCapabilityErrored(ArtifactStarted Started, Exception Exception);
    private sealed record ArtifactUploadCapabilityCompleted(ArtifactGatewayUploadCommand Command, IActorRef ReplyTo, object Admission);
    private sealed record ArtifactUploadCapabilityErrored(ArtifactGatewayUploadCommand Command, IActorRef ReplyTo, Exception Exception);
    private sealed record StartArtifactUpload(ArtifactGatewayUploadCommand Command, IActorRef ReplyTo);
    private sealed record StartArtifactWrite(ArtifactStarted Started);
    private sealed record StartRecoveredArtifactWrite(ArtifactRecovered Recovered);
    private sealed record RecoverableArtifactOperationsLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);
    private sealed record ArtifactRecoveryPreparedMessage(ArtifactRecoveryPrepared Prepared);

    private readonly ResourceGatewayRail<ArtifactWriteOperationPayload> _rail;
    private readonly IArtifactStore _artifactStore;
    private readonly IArtifactBlobStore _blobStore;
    private readonly ICapabilityAdmissionClient? _capabilityAuthority;
    private IActorRef? _artifactWriter;

    public ArtifactGatewayActor(
        IArtifactStore artifactStore,
        IActorAddressResolver resolver,
        IArtifactBlobStore blobStore,
        IResourceOperationInboxStore inboxStore,
        ICapabilityAdmissionClient? capabilityAuthority = null)
    {
        _artifactStore = artifactStore;
        _blobStore = blobStore;
        _capabilityAuthority = capabilityAuthority;
        _rail = new ResourceGatewayRail<ArtifactWriteOperationPayload>(Self, resolver, inboxStore, capabilityAuthority);

        Receive<ArtifactWriteWorkerActor.StartedCompleted>(HandleArtifactWriteCompleted);
        Receive<ArtifactWriteWorkerActor.StartedErrored>(HandleArtifactWriteErrored);
        Receive<ArtifactWriteWorkerActor.RecoveredCompleted>(HandleRecoveredArtifactWriteCompleted);
        Receive<ArtifactWriteWorkerActor.RecoveredErrored>(errored => _rail.FailRecovered(errored.Recovered, ResourceAddress, WorkerAddress, "artifact_write_failed", errored.Exception.Message, IsMissingArtifactException(errored.Exception)));
        Receive<ArtifactCapabilityCompleted>(HandleArtifactCapabilityCompleted);
        Receive<ArtifactCapabilityErrored>(errored =>
            _rail.Reject(errored.Started.DeliverySender, errored.Started.Offer, new OperationError("capability_admission_failed", errored.Exception.Message, true)));
        Receive<ArtifactGatewayUploadCommand>(HandleUploadCommand);
        Receive<ArtifactUploadCapabilityCompleted>(HandleArtifactUploadCapabilityCompleted);
        Receive<ArtifactUploadCapabilityErrored>(message =>
            message.ReplyTo.Tell(new ArtifactGatewayUploadFailed(new OperationError("capability_admission_failed", message.Exception.Message, true)), Self));
        Receive<StartArtifactUpload>(message => StartArtifactUploadAsync(message.Command, message.ReplyTo));
        Receive<ArtifactWriteWorkerActor.UploadCompleted>(message => message.ReplyTo.Tell(new ArtifactGatewayUploadSucceeded(message.Result), Self));
        Receive<ArtifactWriteWorkerActor.UploadErrored>(message =>
        {
            var error = message.Exception is ArtifactWriteWorkerActor.ArtifactWriteRejectedException rejected
                ? rejected.Error
                : new OperationError("artifact_write_failed", message.Exception.Message, IsMissingArtifactException(message.Exception));
            message.ReplyTo.Tell(
                message.Exception is ArtifactWriteWorkerActor.ArtifactWriteRejectedException
                    ? new ArtifactGatewayUploadRejected(error)
                    : new ArtifactGatewayUploadFailed(error),
                Self);
        });
        Receive<ArtifactGatewayReadCommand>(HandleReadCommand);
        Receive<ArtifactGatewayQueryCommand>(HandleQueryCommand);
        Receive<ArtifactReadWorkerActor.ReadCompleted>(HandleArtifactReadCompleted);
        Receive<ArtifactReadWorkerActor.ReadErrored>(message =>
            message.ReplyTo.Tell(new ArtifactGatewayReadFailed(new OperationError("artifact_read_failed", message.Exception.Message, true)), Self));
        Receive<ArtifactReadWorkerActor.QueryCompleted>(message =>
            message.ReplyTo.Tell(new ArtifactGatewayQuerySucceeded(message.Artifacts), Self));
        Receive<ArtifactReadWorkerActor.QueryErrored>(message =>
            message.ReplyTo.Tell(new ArtifactGatewayQueryFailed(new OperationError("artifact_query_failed", message.Exception.Message, true)), Self));
        Receive<ResourceGatewayRail<ArtifactWriteOperationPayload>.RejectRecordedIntentMessage<ArtifactWriteOperationPayload>>(_rail.HandleRejectedRecordedIntent);
        Receive<StartArtifactWrite>(message => StartArtifactWriteAsync(message.Started));
        Receive<StartRecoveredArtifactWrite>(message => StartArtifactWriteAsync(message.Recovered));
        Receive<RecoverableArtifactOperationsLoaded>(loaded => _rail.PrepareRecoveryBatch(loaded.Records, "invalid_artifact_payload", prepared => new ArtifactRecoveryPreparedMessage(prepared)));
        Receive<ArtifactRecoveryPreparedMessage>(HandleArtifactRecoveryPrepared);
        Receive<ResourceGatewayRail<ArtifactWriteOperationPayload>.MarkProcessingMessage<ArtifactWriteOperationPayload>>(_rail.HandleMarkProcessing);
        Receive<ArtifactStoreCommandFailed>(_rail.HandleStoreCommandFailed);

        Receive<DeliveryAttemptOffer>(HandleOffer);
        Receive<RecoverResourceOperations>(_ => RecoverPendingOperations());
    }

    protected override void PreStart()
    {
        RecoverPendingOperations();
        base.PreStart();
    }

    private void HandleReadCommand(ArtifactGatewayReadCommand command)
    {
        var replyTo = Sender;
        var worker = Context.ActorOf(
            Props.Create(() => new ArtifactReadWorkerActor(_artifactStore, Self)),
            $"artifact-read-worker-{Guid.NewGuid():N}");
        worker.Tell(new ArtifactReadWorkerActor.ExecuteRead(command, replyTo), Self);
    }

    private void HandleQueryCommand(ArtifactGatewayQueryCommand command)
    {
        var replyTo = Sender;
        var worker = Context.ActorOf(
            Props.Create(() => new ArtifactReadWorkerActor(_artifactStore, Self)),
            $"artifact-read-worker-{Guid.NewGuid():N}");
        worker.Tell(new ArtifactReadWorkerActor.ExecuteQuery(command, replyTo), Self);
    }

    private void HandleArtifactReadCompleted(ArtifactReadWorkerActor.ReadCompleted completed)
    {
        completed.ReplyTo.Tell(
            completed.Artifact is null
                ? new ArtifactGatewayReadNotFound(completed.Command.ArtifactId)
                : new ArtifactGatewayReadSucceeded(completed.Artifact),
            Self);
    }

    private void HandleOffer(DeliveryAttemptOffer offer)
    {
        if (!_rail.TryStart(
                offer,
                Sender,
                Descriptor,
                "invalid_artifact_payload",
                "Unsupported artifact plan payload.",
                out var started)
            || started is null)
        {
            return;
        }

        if (!_rail.TryResolveCapabilityId(started, Descriptor.PayloadCapabilityId(started.Payload)?.Value, "artifact operation", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _rail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "Artifact capability id could not be resolved.", false));
            return;
        }

        started = resolvedStarted;

        var gateResult = _rail.StartCapabilityGate(
            started,
            started.InboxRecord.ResolvedCapabilityId,
            CapabilityTarget,
            started.Key.OperationType,
            BuildAdmissionAttributes(started.Payload, Encoding.UTF8.GetByteCount(started.Payload.Content)),
            admission => new ArtifactCapabilityCompleted(started, admission),
            ex => new ArtifactCapabilityErrored(started, ex));

        if (gateResult == ArtifactCapabilityGateResult.Stopped)
        {
            return;
        }

        ContinueAfterRecording(started);
    }

    private void HandleUploadCommand(ArtifactGatewayUploadCommand command)
    {
        var replyTo = Sender;
        var self = Self;
        var validationError = ValidateUploadCommand(command);
        if (validationError is not null)
        {
            replyTo.Tell(new ArtifactGatewayUploadRejected(validationError), Self);
            return;
        }

        if (_capabilityAuthority is null)
        {
            Self.Tell(new StartArtifactUpload(command, replyTo), Self);
            return;
        }

        if (command.CapabilityId is null)
        {
            replyTo.Tell(new ArtifactGatewayUploadRejected(new OperationError("capability_required", $"{ResourceOperationTypes.ArtifactCreate} requires a capability id.", false)), Self);
            return;
        }

        var capabilityId = command.CapabilityId ?? throw new InvalidOperationException("Capability id must be present before capability admission starts.");

        _ = _capabilityAuthority.AdmitAsync(new CapabilityAdmissionRequest(
                capabilityId,
                new OperationKey(command.Caller, command.RequestId, ResourceOperationTypes.ArtifactCreate),
                CapabilityTarget,
                ResourceOperationTypes.ArtifactCreate,
                DateTimeOffset.UtcNow,
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["bytes"] = command.Content.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["sourceKind"] = command.SourceKind
                }))
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new ArtifactUploadCapabilityCompleted(command, replyTo, task.Result)
                    : new ArtifactUploadCapabilityErrored(command, replyTo, task.Exception?.GetBaseException() ?? new InvalidOperationException("Capability admission failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void HandleArtifactUploadCapabilityCompleted(ArtifactUploadCapabilityCompleted message)
    {
        if (message.Admission is CapabilityRejected rejected)
        {
            message.ReplyTo.Tell(new ArtifactGatewayUploadRejected(rejected.Error), Self);
            return;
        }

        Self.Tell(new StartArtifactUpload(message.Command, message.ReplyTo), Self);
    }

    private void HandleArtifactCapabilityCompleted(ArtifactCapabilityCompleted completed)
    {
        if (completed.Admission is CapabilityRejected rejected)
        {
            _rail.Reject(completed.Started.DeliverySender, completed.Started.Offer, rejected.Error);
            return;
        }

        ContinueAfterRecording(completed.Started);
    }

    private void ContinueAfterRecording(ArtifactStarted started)
        => _rail.ContinueAfterRecordingAsync(started, pending => new StartArtifactWrite(pending));

    private void StartArtifactUploadAsync(ArtifactGatewayUploadCommand command, IActorRef replyTo)
        => EnsureArtifactWriter().Tell(new ArtifactWriteWorkerActor.ExecuteUpload(command, replyTo), Self);

    private void StartArtifactWriteAsync(ArtifactStarted started)
        => EnsureArtifactWriter().Tell(new ArtifactWriteWorkerActor.ExecuteStarted(started), Self);

    private void StartArtifactWriteAsync(ArtifactRecovered recovered)
        => EnsureArtifactWriter().Tell(new ArtifactWriteWorkerActor.ExecuteRecovered(recovered), Self);

    private IActorRef EnsureArtifactWriter()
    {
        if (_artifactWriter is not null)
        {
            return _artifactWriter;
        }

        _artifactWriter = Context.ActorOf(
            Props.Create(() => new ArtifactWriteWorkerActor(_artifactStore, _blobStore, Self)),
            "artifact-writer");
        return _artifactWriter;
    }

    private void HandleArtifactWriteCompleted(ArtifactWriteWorkerActor.StartedCompleted completed)
    {
        _rail.Resolve(
            completed.Started,
            completed.Started.Key.OperationType,
            JsonSerializer.Serialize(new
            {
                artifactId = completed.Result.ArtifactId.Value,
                revisionId = completed.Result.RevisionId.Value,
                filename = completed.Result.Filename,
                mimeType = completed.Result.MimeType,
                hash = completed.Result.Hash,
                sizeBytes = completed.Result.SizeBytes
            }),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleArtifactWriteErrored(ArtifactWriteWorkerActor.StartedErrored errored)
    {
        if (errored.Exception is ArtifactWriteWorkerActor.ArtifactWriteRejectedException rejected)
        {
            _rail.FailOperation(errored.Started, ResourceAddress, WorkerAddress, rejected.Error.Code, rejected.Error.Message, rejected.Error.Retryable);
            return;
        }

        var isAppendMissingArtifact = errored.Started.Payload.Append && IsMissingArtifactException(errored.Exception);
        _rail.FailOperation(
            errored.Started,
            ResourceAddress,
            WorkerAddress,
            isAppendMissingArtifact ? "artifact_missing_retryable" : "artifact_write_failed",
            errored.Exception.Message,
            isAppendMissingArtifact);
    }

    private void HandleRecoveredArtifactWriteCompleted(ArtifactWriteWorkerActor.RecoveredCompleted completed)
    {
        _rail.ResolveRecovered(
            completed.Recovered,
            completed.Recovered.Key.OperationType,
            JsonSerializer.Serialize(new
            {
                artifactId = completed.Result.ArtifactId.Value,
                revisionId = completed.Result.RevisionId.Value,
                filename = completed.Result.Filename,
                mimeType = completed.Result.MimeType,
                hash = completed.Result.Hash,
                sizeBytes = completed.Result.SizeBytes
            }),
            ResourceAddress,
            WorkerAddress);
    }

    private void RecoverPendingOperations()
        => _rail.ListRecoverableAsync(
            ResourceKinds.Artifact,
            static records => new RecoverableArtifactOperationsLoaded(records),
            ex => new ArtifactStoreCommandFailed("list_recoverable", ResourceKinds.Artifact, ex));

    private void HandleArtifactRecoveryPrepared(ArtifactRecoveryPreparedMessage message)
    {
        if (!message.Prepared.CanStartWork)
        {
            _rail.MarkRecoveryFailedAsync(
                message.Prepared.Record,
                message.Prepared.FailureCode ?? "resource_recovery_failed",
                message.Prepared.FailureMessage ?? "Resource operation recovery failed.");
            return;
        }

        var recovered = message.Prepared.Recovered!;
        if (recovered.Payload.Append && recovered.Payload.ArtifactId is null)
        {
            _rail.FailRecovered(recovered, ResourceAddress, WorkerAddress, "invalid_artifact_payload", "artifactId is required when append=true.", false);
            return;
        }

        _rail.HandleMarkProcessing(new ResourceGatewayRail<ArtifactWriteOperationPayload>.MarkProcessingMessage<ArtifactWriteOperationPayload>(
            recovered.OperationKeyText,
            () => new StartRecoveredArtifactWrite(recovered)));
    }


    private static OperationError? ValidateUploadCommand(ArtifactGatewayUploadCommand command)
    {
        if (string.IsNullOrWhiteSpace(command.Filename))
        {
            return new OperationError("invalid_artifact_upload", "Artifact filename is required.", false);
        }

        if (string.IsNullOrWhiteSpace(command.MimeType))
        {
            return new OperationError("invalid_artifact_upload", "Artifact mimeType is required.", false);
        }

        if (string.IsNullOrWhiteSpace(command.SourceKind))
        {
            return new OperationError("invalid_artifact_upload", "Artifact source kind is required.", false);
        }

        if (command.Content.Length == 0)
        {
            return new OperationError("invalid_artifact_upload", "Artifact content is required.", false);
        }

        return null;
    }


    private static IReadOnlyDictionary<string, string> BuildAdmissionAttributes(ArtifactWriteOperationPayload plan, int bytes)
    {
        var attributes = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["mimeType"] = plan.MimeType,
            ["bytes"] = bytes.ToString(System.Globalization.CultureInfo.InvariantCulture)
        };

        if (plan.SchemaRef is { } schemaRef)
        {
            attributes["schema"] = schemaRef.Value;
        }

        if (!string.IsNullOrWhiteSpace(plan.EvidenceJson))
        {
            attributes["evidenceHandles"] = plan.EvidenceJson;
        }

        return attributes;
    }

    private static bool IsMissingArtifactException(Exception ex) =>
        ex is InvalidOperationException invalidOperation
        && invalidOperation.Message.Contains("was not found", StringComparison.OrdinalIgnoreCase)
        || ex is SqliteException sqlite && sqlite.SqliteErrorCode == 19;

}
