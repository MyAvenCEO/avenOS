using System.Text.Json;
using Akka.Actor;
using Aven.Capabilities.Contracts.Responses;
using Aven.Resources.Llm;
using Aven.Resources.Llm.Contracts;
using Aven.Resources.Llm.Workers;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Llm.Gateways;

using LlmStarted = ResourceGatewayRail<LlmGenerateOperationPayload>.Started;
using LlmRecovered = ResourceGatewayRail<LlmGenerateOperationPayload>.Recovered;
using LlmCapabilityGateResult = ResourceGatewayRail<LlmGenerateOperationPayload>.CapabilityGateResult;
using LlmRecoveryPrepared = ResourceGatewayRail<LlmGenerateOperationPayload>.RecoveryPrepared;
using LlmStoreCommandFailed = ResourceGatewayRail<LlmGenerateOperationPayload>.StoreCommandFailed;
using StructuredStarted = ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Started;
using StructuredRecovered = ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Recovered;
using StructuredCapabilityGateResult = ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.CapabilityGateResult;
using StructuredRecoveryPrepared = ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.RecoveryPrepared;
using StructuredStoreCommandFailed = ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.StoreCommandFailed;

public sealed class LlmGatewayActor : ReceiveActor
{
    private static readonly LlmModelCapabilities FallbackModel = new("api-runtime-model", true, true, true, true, true, false);
    private static readonly ActorAddress ResourceAddress = ResourceAddresses.Gateway(ResourceKinds.Llm);
    private static readonly ActorAddress WorkerAddress = ResourceAddresses.Worker(ResourceKinds.Llm);
    private static readonly ResourceOperationDescriptor<LlmGenerateOperationPayload> Descriptor = new(
        ResourceKinds.Llm,
        static _ => ResourceOperationTypes.LlmGenerate,
        (sender, payload) => new OperationKey(sender, new RequestId(payload.RequestId), ResourceOperationTypes.LlmGenerate),
        payload => string.IsNullOrWhiteSpace(payload.CapabilityId) ? null : new CapabilityId(payload.CapabilityId),
        payload => string.IsNullOrWhiteSpace(payload.RequestId)
            ? ValidationResult.Failure("invalid_llm_payload", "LLM requestId is required.")
            : payload.Artifact == default
                ? ValidationResult.Failure("invalid_llm_payload", "LLM artifact reference is required.")
                : payload.SchemaRef == default || string.IsNullOrWhiteSpace(payload.SchemaRef.Value)
                    ? ValidationResult.Failure("invalid_llm_payload", "LLM schemaRef is required.")
                    : string.IsNullOrWhiteSpace(payload.Prompt)
                        ? ValidationResult.Failure("invalid_llm_payload", "LLM prompt is required.")
                        : string.IsNullOrWhiteSpace(payload.Purpose)
                            ? ValidationResult.Failure("invalid_llm_payload", "LLM purpose is required.")
                            : ValidationResult.Success);

    private static readonly ResourceOperationDescriptor<LlmStructuredGenerateOperationPayload> StructuredDescriptor = new(
        ResourceKinds.Llm,
        static _ => ResourceOperationTypes.LlmStructuredGenerate,
        (sender, payload) => new OperationKey(sender, new RequestId(payload.RequestId), ResourceOperationTypes.LlmStructuredGenerate),
        payload => string.IsNullOrWhiteSpace(payload.CapabilityId) ? null : new CapabilityId(payload.CapabilityId),
        payload => string.IsNullOrWhiteSpace(payload.RequestId)
            ? ValidationResult.Failure("invalid_llm_structured_payload", "Structured LLM requestId is required.")
            : payload.Input is null || payload.Input.Count == 0
                ? ValidationResult.Failure("invalid_llm_structured_payload", "Structured LLM input is required.")
                : payload.SchemaRef == default || string.IsNullOrWhiteSpace(payload.SchemaRef.Value)
                    ? ValidationResult.Failure("invalid_llm_structured_payload", "Structured LLM schemaRef is required.")
                    : string.IsNullOrWhiteSpace(payload.Purpose)
                        ? ValidationResult.Failure("invalid_llm_structured_payload", "Structured LLM purpose is required.")
                        : ValidationResult.Success);

    private sealed record LlmCapabilityCompleted(LlmStarted Started, object Admission);
    private sealed record LlmCapabilityErrored(LlmStarted Started, Exception Exception);
    private sealed record StartLlmExtraction(LlmStarted Started);
    private sealed record StartRecoveredLlmExtraction(LlmRecovered Recovered);
    private sealed record RecoverableLlmOperationsLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);
    private sealed record LlmRecoveryPreparedMessage(LlmRecoveryPrepared Prepared);
    private sealed record StructuredGenerationCapabilityCompleted(LlmStructuredGenerationCommand Command, IActorRef ReplyTo, object Admission);
    private sealed record StructuredGenerationCapabilityErrored(LlmStructuredGenerationCommand Command, IActorRef ReplyTo, Exception Exception);
    private sealed record StartStructuredGeneration(LlmStructuredGenerationCommand Command, IActorRef ReplyTo);
    private sealed record StructuredOperationCapabilityCompleted(StructuredStarted Started, object Admission);
    private sealed record StructuredOperationCapabilityErrored(StructuredStarted Started, Exception Exception);
    private sealed record StartDurableStructuredGeneration(StructuredStarted Started);
    private sealed record StartRecoveredStructuredGeneration(StructuredRecovered Recovered);
    private sealed record StructuredRecoveryPreparedMessage(StructuredRecoveryPrepared Prepared);

    private readonly ResourceGatewayRail<LlmGenerateOperationPayload> _rail;
    private readonly ResourceGatewayRail<LlmStructuredGenerateOperationPayload> _structuredRail;
    private readonly IActorRef _schemaRegistryActor;
    private readonly LlmExtractionPipeline _extractionPipeline;
    private readonly ICapabilityAdmissionClient? _capabilityAuthority;
    private readonly LlmModelCapabilities _defaultModel;

    public LlmGatewayActor(
        IActorAddressResolver resolver,
        IActorRef schemaRegistryActor,
        LlmExtractionPipeline extractionPipeline,
        IResourceOperationInboxStore inboxStore,
        ICapabilityAdmissionClient? capabilityAuthority = null,
        LlmModelCapabilities? defaultModel = null)
    {
        _schemaRegistryActor = schemaRegistryActor;
        _extractionPipeline = extractionPipeline;
        _capabilityAuthority = capabilityAuthority;
        _defaultModel = defaultModel ?? FallbackModel;
        _rail = new ResourceGatewayRail<LlmGenerateOperationPayload>(Self, resolver, inboxStore, capabilityAuthority);
        _structuredRail = new ResourceGatewayRail<LlmStructuredGenerateOperationPayload>(Self, resolver, inboxStore, capabilityAuthority);

        Receive<LlmExtractionWorkerActor.StartedCompleted>(HandleExtractionCompleted);
        Receive<LlmExtractionWorkerActor.StartedErrored>(HandleExtractionErrored);
        Receive<LlmExtractionWorkerActor.RecoveredCompleted>(HandleRecoveredExtractionCompleted);
        Receive<LlmExtractionWorkerActor.RecoveredErrored>(errored => _rail.FailRecovered(errored.Recovered, ResourceAddress, WorkerAddress, "llm_extraction_failed", errored.Exception.Message));
        Receive<LlmCapabilityCompleted>(HandleLlmCapabilityCompleted);
        Receive<LlmCapabilityErrored>(errored =>
            _rail.Reject(errored.Started.DeliverySender, errored.Started.Offer, new OperationError("capability_admission_failed", errored.Exception.Message, true)));
        Receive<ResourceGatewayRail<LlmGenerateOperationPayload>.RejectRecordedIntentMessage<LlmGenerateOperationPayload>>(_rail.HandleRejectedRecordedIntent);
        Receive<StartLlmExtraction>(message => SpawnExtractionWorker(message.Started));
        Receive<StartRecoveredLlmExtraction>(message => SpawnExtractionWorker(message.Recovered));
        Receive<RecoverableLlmOperationsLoaded>(HandleRecoverableLlmOperationsLoaded);
        Receive<LlmRecoveryPreparedMessage>(message =>
        {
            var next = _rail.HandlePreparedRecovery(message.Prepared, recovered => new StartRecoveredLlmExtraction(recovered));
            if (next is ResourceGatewayRail<LlmGenerateOperationPayload>.MarkProcessingMessage<LlmGenerateOperationPayload> markProcessing)
            {
                _rail.HandleMarkProcessing(markProcessing);
            }
        });
        Receive<ResourceGatewayRail<LlmGenerateOperationPayload>.MarkProcessingMessage<LlmGenerateOperationPayload>>(_rail.HandleMarkProcessing);
        Receive<LlmStoreCommandFailed>(_rail.HandleStoreCommandFailed);
        Receive<LlmStructuredGenerationCommand>(HandleStructuredGenerationCommand);
        Receive<StructuredGenerationCapabilityCompleted>(HandleStructuredGenerationCapabilityCompleted);
        Receive<StructuredGenerationCapabilityErrored>(message =>
            message.ReplyTo.Tell(new LlmStructuredGenerationFailed(new OperationError("capability_admission_failed", message.Exception.Message, true)), Self));
        Receive<StartStructuredGeneration>(message => SpawnStructuredGenerationWorker(message.Command, message.ReplyTo));
        Receive<LlmStructuredGenerationWorkerActor.DirectCompleted>(message =>
            message.ReplyTo.Tell(new LlmStructuredGenerationSucceeded(message.Key, message.CorrelationId, message.Response, message.StructuredJson), Self));
        Receive<LlmStructuredGenerationWorkerActor.DirectErrored>(message =>
            message.ReplyTo.Tell(message.Error.Code is "capability_required" or "capability_id_invalid" or "invalid_llm_structured_generation" or "schema_not_found"
                ? new LlmStructuredGenerationRejected(message.Error)
                : new LlmStructuredGenerationFailed(message.Error), Self));
        Receive<StructuredOperationCapabilityCompleted>(HandleStructuredOperationCapabilityCompleted);
        Receive<StructuredOperationCapabilityErrored>(errored =>
            _structuredRail.Reject(errored.Started.DeliverySender, errored.Started.Offer, new OperationError("capability_admission_failed", errored.Exception.Message, true)));
        Receive<StartDurableStructuredGeneration>(message => SpawnStructuredGenerationWorker(message.Started));
        Receive<StartRecoveredStructuredGeneration>(message => SpawnStructuredGenerationWorker(message.Recovered));
        Receive<LlmStructuredGenerationWorkerActor.StartedCompleted>(HandleDurableStructuredGenerationCompleted);
        Receive<LlmStructuredGenerationWorkerActor.StartedErrored>(HandleDurableStructuredGenerationErrored);
        Receive<LlmStructuredGenerationWorkerActor.RecoveredCompleted>(HandleRecoveredStructuredGenerationCompleted);
        Receive<LlmStructuredGenerationWorkerActor.RecoveredErrored>(HandleRecoveredStructuredGenerationErrored);
        Receive<ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.RejectRecordedIntentMessage<LlmStructuredGenerateOperationPayload>>(_structuredRail.HandleRejectedRecordedIntent);
        Receive<StructuredRecoveryPreparedMessage>(message =>
        {
            var next = _structuredRail.HandlePreparedRecovery(message.Prepared, recovered => new StartRecoveredStructuredGeneration(recovered));
            if (next is ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.MarkProcessingMessage<LlmStructuredGenerateOperationPayload> markProcessing)
            {
                _structuredRail.HandleMarkProcessing(markProcessing);
            }
        });
        Receive<ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.MarkProcessingMessage<LlmStructuredGenerateOperationPayload>>(_structuredRail.HandleMarkProcessing);
        Receive<StructuredStoreCommandFailed>(_structuredRail.HandleStoreCommandFailed);
        Receive<DeliveryAttemptOffer>(HandleOffer);
        Receive<RecoverResourceOperations>(_ => RecoverPendingOperations());
    }

    protected override void PreStart()
    {
        RecoverPendingOperations();
        base.PreStart();
    }

    private void HandleOffer(DeliveryAttemptOffer offer)
    {
        if (string.Equals(offer.Envelope.MessageType, ResourceOperationTypes.LlmStructuredGenerate, StringComparison.Ordinal))
        {
            HandleStructuredOffer(offer);
            return;
        }

        if (string.Equals(offer.Envelope.MessageType, ResourceOperationTypes.LlmGenerate, StringComparison.Ordinal))
        {
            HandleExtractionOffer(offer);
            return;
        }

        _rail.Reject(
            Sender,
            offer,
            new OperationError("unsupported_operation_type", $"LLM gateway does not support operation '{offer.Envelope.MessageType}'.", false));
    }

    private void HandleExtractionOffer(DeliveryAttemptOffer offer)
    {
        if (!_rail.TryStart(
                offer,
                Sender,
                Descriptor,
                "invalid_llm_payload",
                "Unsupported LLM plan payload.",
                out var started)
            || started is null)
        {
            return;
        }

        if (!_rail.TryResolveCapabilityId(started, Descriptor.PayloadCapabilityId(started.Payload)?.Value, "LLM operation", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _rail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "LLM capability id could not be resolved.", false));
            return;
        }

        var gateResult = _rail.StartCapabilityGate(
            resolvedStarted,
            resolvedStarted.InboxRecord.ResolvedCapabilityId,
            ResourceAddresses.Gateway(ResourceKinds.Llm),
            ResourceOperationTypes.LlmGenerate,
            attributes: null,
            admission => new LlmCapabilityCompleted(resolvedStarted, admission),
            ex => new LlmCapabilityErrored(resolvedStarted, ex));

        if (gateResult == LlmCapabilityGateResult.Stopped)
        {
            return;
        }

        ContinueAfterRecording(resolvedStarted);
    }

    private void HandleStructuredOffer(DeliveryAttemptOffer offer)
    {
        if (!_structuredRail.TryStart(
                offer,
                Sender,
                StructuredDescriptor,
                "invalid_llm_structured_payload",
                "Unsupported structured LLM payload.",
                out var started)
            || started is null)
        {
            return;
        }

        if (!_structuredRail.TryResolveCapabilityId(started, StructuredDescriptor.PayloadCapabilityId(started.Payload)?.Value, "structured LLM operation", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _structuredRail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "Structured LLM capability id could not be resolved.", false));
            return;
        }

        var gateResult = _structuredRail.StartCapabilityGate(
            resolvedStarted,
            resolvedStarted.InboxRecord.ResolvedCapabilityId,
            ResourceAddresses.Gateway(ResourceKinds.Llm),
            ResourceOperationTypes.LlmStructuredGenerate,
            attributes: null,
            admission => new StructuredOperationCapabilityCompleted(resolvedStarted, admission),
            ex => new StructuredOperationCapabilityErrored(resolvedStarted, ex));

        if (gateResult == StructuredCapabilityGateResult.Stopped)
        {
            return;
        }

        ContinueAfterRecording(resolvedStarted);
    }

    private void ContinueAfterRecording(LlmStarted started)
        => _rail.ContinueAfterRecordingAsync(started, pending => new StartLlmExtraction(pending));

    private void ContinueAfterRecording(StructuredStarted started)
        => _structuredRail.ContinueAfterRecordingAsync(started, pending => new StartDurableStructuredGeneration(pending));

    private void HandleLlmCapabilityCompleted(LlmCapabilityCompleted completed)
    {
        if (completed.Admission is CapabilityRejected rejected)
        {
            _rail.Reject(completed.Started.DeliverySender, completed.Started.Offer, rejected.Error);
            return;
        }

        ContinueAfterRecording(completed.Started);
    }

    private void SpawnExtractionWorker(LlmStarted started)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new LlmExtractionWorkerActor(_schemaRegistryActor, _extractionPipeline, _defaultModel, Self)),
            $"llm-extraction-worker-{Guid.NewGuid():N}");
        worker.Tell(new LlmExtractionWorkerActor.ExecuteStarted(started), Self);
    }

    private void SpawnExtractionWorker(LlmRecovered recovered)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new LlmExtractionWorkerActor(_schemaRegistryActor, _extractionPipeline, _defaultModel, Self)),
            $"llm-extraction-worker-{Guid.NewGuid():N}");
        worker.Tell(new LlmExtractionWorkerActor.ExecuteRecovered(recovered), Self);
    }

    private void HandleExtractionCompleted(LlmExtractionWorkerActor.StartedCompleted completed)
    {
        if (!completed.Result.SchemaValidated)
        {
            _rail.FailOperation(
                completed.Started,
                ResourceAddress,
                WorkerAddress,
                "llm_extraction_invalid",
                string.Join("; ", completed.Result.ValidationErrors));
            return;
        }

        _rail.Resolve(
            completed.Started,
            ResourceOperationTypes.LlmGenerate,
            JsonSerializer.Serialize(new
            {
                artifactId = completed.Result.SourceArtifact.Artifact.ArtifactId.Value,
                revisionId = completed.Result.SourceArtifact.Artifact.RevisionId?.Value,
                structuredJson = completed.Result.StructuredJson,
                transportSummary = completed.Result.TransportSummary,
                evidence = completed.Result.Evidence,
                degradations = completed.Result.Degradations
            }),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleExtractionErrored(LlmExtractionWorkerActor.StartedErrored errored)
    {
        _rail.FailOperation(errored.Started, ResourceAddress, WorkerAddress, "llm_extraction_failed", errored.Exception.Message);
    }

    private void HandleRecoveredExtractionCompleted(LlmExtractionWorkerActor.RecoveredCompleted completed)
    {
        if (!completed.Result.SchemaValidated)
        {
            _rail.FailRecovered(
                completed.Recovered,
                ResourceAddress,
                WorkerAddress,
                "llm_extraction_invalid",
                string.Join("; ", completed.Result.ValidationErrors));
            return;
        }

        _rail.ResolveRecovered(
            completed.Recovered,
            ResourceOperationTypes.LlmGenerate,
            JsonSerializer.Serialize(new
            {
                artifactId = completed.Result.SourceArtifact.Artifact.ArtifactId.Value,
                revisionId = completed.Result.SourceArtifact.Artifact.RevisionId?.Value,
                structuredJson = completed.Result.StructuredJson,
                transportSummary = completed.Result.TransportSummary,
                evidence = completed.Result.Evidence,
                degradations = completed.Result.Degradations
            }),
            ResourceAddress,
            WorkerAddress);
    }

    private void RecoverPendingOperations()
        => _rail.ListRecoverableAsync(
            ResourceKinds.Llm,
            static records => new RecoverableLlmOperationsLoaded(records),
            ex => new LlmStoreCommandFailed("list_recoverable", ResourceKinds.Llm, ex));

    private void HandleRecoverableLlmOperationsLoaded(RecoverableLlmOperationsLoaded loaded)
    {
        var extractionRecords = loaded.Records
            .Where(static record => string.Equals(record.OperationType, ResourceOperationTypes.LlmGenerate, StringComparison.Ordinal))
            .ToArray();
        var structuredRecords = loaded.Records
            .Where(static record => string.Equals(record.OperationType, ResourceOperationTypes.LlmStructuredGenerate, StringComparison.Ordinal))
            .ToArray();

        _rail.PrepareRecoveryBatch(extractionRecords, "invalid_llm_payload", prepared => new LlmRecoveryPreparedMessage(prepared));
        _structuredRail.PrepareRecoveryBatch(structuredRecords, "invalid_llm_structured_payload", prepared => new StructuredRecoveryPreparedMessage(prepared));
    }

    private void HandleStructuredOperationCapabilityCompleted(StructuredOperationCapabilityCompleted completed)
    {
        if (completed.Admission is CapabilityRejected rejected)
        {
            _structuredRail.Reject(completed.Started.DeliverySender, completed.Started.Offer, rejected.Error);
            return;
        }

        ContinueAfterRecording(completed.Started);
    }

    private void SpawnStructuredGenerationWorker(StructuredStarted started)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new LlmStructuredGenerationWorkerActor(_schemaRegistryActor, _extractionPipeline, _defaultModel, Self)),
            $"llm-structured-worker-{Guid.NewGuid():N}");
        worker.Tell(new LlmStructuredGenerationWorkerActor.ExecuteStarted(started), Self);
    }

    private void SpawnStructuredGenerationWorker(StructuredRecovered recovered)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new LlmStructuredGenerationWorkerActor(_schemaRegistryActor, _extractionPipeline, _defaultModel, Self)),
            $"llm-structured-worker-{Guid.NewGuid():N}");
        worker.Tell(new LlmStructuredGenerationWorkerActor.ExecuteRecovered(recovered), Self);
    }

    private void HandleDurableStructuredGenerationCompleted(LlmStructuredGenerationWorkerActor.StartedCompleted completed)
    {
        _structuredRail.Resolve(
            completed.Started,
            ResourceOperationTypes.LlmStructuredGenerate,
            SerializeStructuredRoleResult(completed.Response, completed.StructuredJson),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleDurableStructuredGenerationErrored(LlmStructuredGenerationWorkerActor.StartedErrored errored)
    {
        _structuredRail.FailOperation(
            errored.Started,
            ResourceAddress,
            WorkerAddress,
            errored.Error.Code,
            errored.Error.Message,
            errored.Error.Retryable);
    }

    private void HandleRecoveredStructuredGenerationCompleted(LlmStructuredGenerationWorkerActor.RecoveredCompleted completed)
    {
        _structuredRail.ResolveRecovered(
            completed.Recovered,
            ResourceOperationTypes.LlmStructuredGenerate,
            SerializeStructuredRoleResult(completed.Response, completed.StructuredJson),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleRecoveredStructuredGenerationErrored(LlmStructuredGenerationWorkerActor.RecoveredErrored errored)
    {
        _structuredRail.FailRecovered(
            errored.Recovered,
            ResourceAddress,
            WorkerAddress,
            errored.Error.Code,
            errored.Error.Message,
            errored.Error.Retryable);
    }

    private static string SerializeStructuredRoleResult(LlmResponse response, string structuredJson) =>
        JsonSerializer.Serialize(new
        {
            structuredJson,
            provider = response.Provider,
            model = response.Model,
            text = response.Text,
            refusal = response.Refusal,
            safetyBlock = response.SafetyBlock,
            reasoningSummary = response.ReasoningSummary,
            citations = response.Citations,
            usage = response.Usage,
            finishReason = response.FinishReason,
            degradations = response.Degradations
        });


    private void HandleStructuredGenerationCommand(LlmStructuredGenerationCommand command)
    {
        var replyTo = Sender;
        var validationError = ValidateStructuredGenerationCommand(command);
        if (validationError is not null)
        {
            replyTo.Tell(new LlmStructuredGenerationRejected(validationError), Self);
            return;
        }

        if (_capabilityAuthority is null)
        {
            Self.Tell(new StartStructuredGeneration(command, replyTo), Self);
            return;
        }

        if (command.CapabilityId is null)
        {
            replyTo.Tell(new LlmStructuredGenerationRejected(new OperationError("capability_required", $"{ResourceOperationTypes.LlmStructuredGenerate} requires a capability id.", false)), Self);
            return;
        }

        var self = Self;
        var capabilityId = command.CapabilityId ?? throw new InvalidOperationException("CapabilityId was required before admission.");
        _ = _capabilityAuthority.AdmitAsync(new CapabilityAdmissionRequest(
                capabilityId,
                new OperationKey(command.Caller, command.RequestId, ResourceOperationTypes.LlmStructuredGenerate),
                ResourceAddresses.Gateway(ResourceKinds.Llm),
                ResourceOperationTypes.LlmStructuredGenerate,
                DateTimeOffset.UtcNow,
                null))
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StructuredGenerationCapabilityCompleted(command, replyTo, task.Result)
                    : new StructuredGenerationCapabilityErrored(command, replyTo, task.Exception?.GetBaseException() ?? new InvalidOperationException("Capability admission failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void HandleStructuredGenerationCapabilityCompleted(StructuredGenerationCapabilityCompleted message)
    {
        if (message.Admission is CapabilityRejected rejected)
        {
            message.ReplyTo.Tell(new LlmStructuredGenerationRejected(rejected.Error), Self);
            return;
        }

        Self.Tell(new StartStructuredGeneration(message.Command, message.ReplyTo), Self);
    }

    private void SpawnStructuredGenerationWorker(LlmStructuredGenerationCommand command, IActorRef replyTo)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new LlmStructuredGenerationWorkerActor(_schemaRegistryActor, _extractionPipeline, _defaultModel, Self)),
            $"llm-structured-worker-{Guid.NewGuid():N}");
        worker.Tell(new LlmStructuredGenerationWorkerActor.ExecuteDirect(command, replyTo), Self);
    }

    private static OperationError? ValidateStructuredGenerationCommand(LlmStructuredGenerationCommand command)
        => string.IsNullOrWhiteSpace(command.RequestId.Value)
            ? new OperationError("invalid_llm_structured_generation", "RequestId is required.", false)
            : string.IsNullOrWhiteSpace(command.Caller.Value)
                ? new OperationError("invalid_llm_structured_generation", "Caller is required.", false)
                : command.Input.Count == 0
                    ? new OperationError("invalid_llm_structured_generation", "At least one input block is required.", false)
                    : command.SchemaRef == default || string.IsNullOrWhiteSpace(command.SchemaRef.Value)
                        ? new OperationError("invalid_llm_structured_generation", "SchemaRef is required.", false)
                        : string.IsNullOrWhiteSpace(command.Purpose)
                            ? new OperationError("invalid_llm_structured_generation", "Purpose is required.", false)
                            : null;

}
