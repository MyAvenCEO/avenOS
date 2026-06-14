using System.Text.Json;
using Akka.Actor;
using Aven.Capabilities.Contracts.Responses;
using Aven.Scheduling.Workers;
using Aven.Resources.Runtime.Gateways;
using Aven.Scheduling.Contracts;

namespace Aven.Scheduling.Gateways;

using ScheduleStarted = ResourceGatewayRail<ScheduledWorkOperationPayload>.Started;
using ScheduleRecovered = ResourceGatewayRail<ScheduledWorkOperationPayload>.Recovered;
using ScheduleCapabilityGateResult = ResourceGatewayRail<ScheduledWorkOperationPayload>.CapabilityGateResult;
using ScheduleRecoveryPrepared = ResourceGatewayRail<ScheduledWorkOperationPayload>.RecoveryPrepared;
using ScheduleStoreCommandFailed = ResourceGatewayRail<ScheduledWorkOperationPayload>.StoreCommandFailed;

public sealed class ScheduleGatewayActor : ReceiveActor
{
    private static readonly ActorAddress CapabilityTarget = ResourceAddresses.Gateway(ResourceKinds.Schedule);
    private static readonly ActorAddress ResourceAddress = ResourceAddresses.Gateway(ResourceKinds.Schedule);
    private static readonly ActorAddress WorkerAddress = ResourceAddresses.Worker(ResourceKinds.Schedule);
    private static readonly ResourceOperationDescriptor<ScheduledWorkOperationPayload> Descriptor = new(
        ResourceKinds.Schedule,
        static _ => ResourceOperationTypes.ScheduleCreate,
        (sender, payload) => new OperationKey(sender, new RequestId(payload.RequestId), ResourceOperationTypes.ScheduleCreate),
        payload => string.IsNullOrWhiteSpace(payload.CapabilityId) ? null : new CapabilityId(payload.CapabilityId),
        payload => string.IsNullOrWhiteSpace(payload.RequestId)
            ? ValidationResult.Failure("invalid_schedule_payload", "Schedule requestId is required.")
            : string.IsNullOrWhiteSpace(payload.ScheduleId)
                ? ValidationResult.Failure("invalid_schedule_payload", "Schedule scheduleId is required.")
                : payload.TargetAgent == default
                    ? ValidationResult.Failure("invalid_schedule_payload", "Schedule target agent is required.")
                    : string.IsNullOrWhiteSpace(payload.TargetAgent.Value) || string.IsNullOrWhiteSpace(payload.TargetAgent.Protocol)
                        ? ValidationResult.Failure("invalid_schedule_payload", "Schedule target agent is required.")
                        : string.IsNullOrWhiteSpace(payload.TargetOperationType)
                            ? ValidationResult.Failure("invalid_schedule_payload", "Schedule target operation type is required.")
                            : string.IsNullOrWhiteSpace(payload.CommandPayloadJson)
                                ? ValidationResult.Failure("invalid_schedule_payload", "Schedule command payload is required.")
                                : ValidationResult.Success);

    private sealed record ScheduleCapabilityCompleted(ScheduleStarted Started, object Admission);
    private sealed record ScheduleCapabilityErrored(ScheduleStarted Started, Exception Exception);
    private sealed record StartScheduleCreate(ScheduleStarted Started);
    private sealed record StartRecoveredScheduleCreate(ScheduleRecovered Recovered);
    private sealed record RecoverableScheduleOperationsLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);
    private sealed record ScheduleRecoveryPreparedMessage(ScheduleRecoveryPrepared Prepared);

    private readonly ResourceGatewayRail<ScheduledWorkOperationPayload> _rail;
    private readonly Func<object, IActorRef> _scheduleFactory;

    public ScheduleGatewayActor(
        Func<object, IActorRef> scheduleFactory,
        IActorAddressResolver resolver,
        IResourceOperationInboxStore inboxStore,
        ICapabilityAdmissionClient? capabilityAuthority = null)
    {
        _scheduleFactory = scheduleFactory;
        _rail = new ResourceGatewayRail<ScheduledWorkOperationPayload>(Self, resolver, inboxStore, capabilityAuthority);

        Receive<ScheduleCapabilityCompleted>(HandleScheduleCapabilityCompleted);
        Receive<ScheduleCapabilityErrored>(errored =>
            _rail.Reject(errored.Started.DeliverySender, errored.Started.Offer, new OperationError("capability_admission_failed", errored.Exception.Message, true)));
        Receive<ScheduleCreateWorkerActor.StartedCompleted>(HandleScheduleCreated);
        Receive<ScheduleCreateWorkerActor.StartedErrored>(errored =>
            _rail.FailOperation(errored.Started, ResourceAddress, WorkerAddress, "schedule_create_failed", errored.Exception.Message, true));
        Receive<ScheduleCreateWorkerActor.RecoveredCompleted>(HandleRecoveredScheduleCreated);
        Receive<ScheduleCreateWorkerActor.RecoveredErrored>(errored =>
            _rail.FailRecovered(errored.Recovered, ResourceAddress, WorkerAddress, "schedule_create_failed", errored.Exception.Message, true));
        Receive<ResourceGatewayRail<ScheduledWorkOperationPayload>.RejectRecordedIntentMessage<ScheduledWorkOperationPayload>>(_rail.HandleRejectedRecordedIntent);
        Receive<StartScheduleCreate>(message => StartScheduleCreateAsync(message.Started));
        Receive<StartRecoveredScheduleCreate>(message => StartScheduleCreateAsync(message.Recovered));
        Receive<RecoverableScheduleOperationsLoaded>(loaded => _rail.PrepareRecoveryBatch(loaded.Records, "invalid_schedule_payload", prepared => new ScheduleRecoveryPreparedMessage(prepared)));
        Receive<ScheduleRecoveryPreparedMessage>(message =>
        {
            var next = _rail.HandlePreparedRecovery(message.Prepared, recovered => new StartRecoveredScheduleCreate(recovered));
            if (next is ResourceGatewayRail<ScheduledWorkOperationPayload>.MarkProcessingMessage<ScheduledWorkOperationPayload> markProcessing)
            {
                _rail.HandleMarkProcessing(markProcessing);
            }
        });
        Receive<ResourceGatewayRail<ScheduledWorkOperationPayload>.MarkProcessingMessage<ScheduledWorkOperationPayload>>(_rail.HandleMarkProcessing);
        Receive<ScheduleStoreCommandFailed>(_rail.HandleStoreCommandFailed);

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
        if (!_rail.TryStart(
                offer,
                Sender,
                Descriptor,
                "invalid_schedule_payload",
                "Unsupported schedule plan payload.",
                out var started)
            || started is null)
        {
            return;
        }

        if (!_rail.TryResolveCapabilityId(started, Descriptor.PayloadCapabilityId(started.Payload)?.Value, "schedule operation", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _rail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "Schedule capability id could not be resolved.", false));
            return;
        }

        started = resolvedStarted;

        var gateResult = _rail.StartCapabilityGate(
            started,
            started.InboxRecord.ResolvedCapabilityId,
            CapabilityTarget,
            ResourceOperationTypes.ScheduleCreate,
            null,
            admission => new ScheduleCapabilityCompleted(started, admission),
            ex => new ScheduleCapabilityErrored(started, ex));

        if (gateResult == ScheduleCapabilityGateResult.Stopped)
        {
            return;
        }

        ContinueAfterRecording(started);
    }

    private void HandleScheduleCapabilityCompleted(ScheduleCapabilityCompleted completed)
    {
        if (completed.Admission is CapabilityRejected rejected)
        {
            _rail.Reject(completed.Started.DeliverySender, completed.Started.Offer, rejected.Error);
            return;
        }

        ContinueAfterRecording(completed.Started);
    }

    private void ContinueAfterRecording(ScheduleStarted started)
        => _rail.ContinueAfterRecordingAsync(started, pending => new StartScheduleCreate(pending));

    private void StartScheduleCreateAsync(ScheduleStarted started)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new ScheduleCreateWorkerActor(_scheduleFactory, Self)),
            $"schedule-create-worker-{Guid.NewGuid():N}");
        worker.Tell(new ScheduleCreateWorkerActor.ExecuteStarted(started), Self);
    }

    private void StartScheduleCreateAsync(ScheduleRecovered recovered)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new ScheduleCreateWorkerActor(_scheduleFactory, Self)),
            $"schedule-create-worker-{Guid.NewGuid():N}");
        worker.Tell(new ScheduleCreateWorkerActor.ExecuteRecovered(recovered), Self);
    }

    private void HandleScheduleCreated(ScheduleCreateWorkerActor.StartedCompleted completed)
    {
        _rail.Resolve(
            completed.Started,
            ResourceOperationTypes.ScheduleCreate,
            JsonSerializer.Serialize(new
            {
                scheduleId = completed.Started.Payload.ScheduleId,
                targetOperationType = completed.Started.Payload.TargetOperationType,
                dueAt = completed.Started.Payload.DueAt
            }),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleRecoveredScheduleCreated(ScheduleCreateWorkerActor.RecoveredCompleted completed)
    {
        _rail.ResolveRecovered(
            completed.Recovered,
            ResourceOperationTypes.ScheduleCreate,
            JsonSerializer.Serialize(new
            {
                scheduleId = completed.Recovered.Payload.ScheduleId,
                targetOperationType = completed.Recovered.Payload.TargetOperationType,
                dueAt = completed.Recovered.Payload.DueAt
            }),
            ResourceAddress,
            WorkerAddress);
    }

    private void RecoverPendingOperations()
        => _rail.ListRecoverableAsync(
            ResourceKinds.Schedule,
            static records => new RecoverableScheduleOperationsLoaded(records),
            ex => new ScheduleStoreCommandFailed("list_recoverable", ResourceKinds.Schedule, ex));

}
