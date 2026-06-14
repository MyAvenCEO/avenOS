using System.Text.Json;

namespace Aven.Resources.Shell.Gateways;

using ShellStarted = ResourceGatewayRail<ShellExecuteOperationPayload>.Started;
using ShellRecovered = ResourceGatewayRail<ShellExecuteOperationPayload>.Recovered;
using ShellCapabilityGateResult = ResourceGatewayRail<ShellExecuteOperationPayload>.CapabilityGateResult;
using ShellRecoveryPrepared = ResourceGatewayRail<ShellExecuteOperationPayload>.RecoveryPrepared;
using ShellStoreCommandFailed = ResourceGatewayRail<ShellExecuteOperationPayload>.StoreCommandFailed;

public sealed class ShellGatewayActor : ReceiveActor
{
    private static readonly ActorAddress ResourceAddress = ResourceAddresses.Gateway(ResourceKinds.Shell);
    private static readonly ActorAddress WorkerAddress = ResourceAddresses.Worker(ResourceKinds.Shell);
    private static readonly ResourceOperationDescriptor<ShellExecuteOperationPayload> Descriptor = new(
        ResourceKinds.Shell,
        static _ => ResourceOperationTypes.ShellExecute,
        (sender, payload) => new OperationKey(sender, new RequestId(payload.RequestId), ResourceOperationTypes.ShellExecute),
        payload => string.IsNullOrWhiteSpace(payload.CapabilityId) ? null : new CapabilityId(payload.CapabilityId),
        payload => string.IsNullOrWhiteSpace(payload.RequestId)
            ? ValidationResult.Failure("invalid_shell_payload", "Shell requestId is required.")
            : string.IsNullOrWhiteSpace(payload.Command)
                ? ValidationResult.Failure("invalid_shell_payload", "Shell command is required.")
                : payload.TimeoutSeconds <= 0
                    ? ValidationResult.Failure("invalid_shell_payload", "Shell timeoutSeconds must be positive.")
                    : payload.MaxOutputBytes <= 0
                        ? ValidationResult.Failure("invalid_shell_payload", "Shell maxOutputBytes must be positive.")
                        : ValidationResult.Success);

    private sealed record ShellCapabilityCompleted(ShellStarted Started, object Admission);
    private sealed record ShellCapabilityErrored(ShellStarted Started, Exception Exception);
    private sealed record StartShellExecution(ShellStarted Started);
    private sealed record StartRecoveredShellExecution(ShellRecovered Recovered);
    private sealed record RecoverableShellOperationsLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);
    private sealed record ShellRecoveryPreparedMessage(ShellRecoveryPrepared Prepared);

    private readonly ResourceGatewayRail<ShellExecuteOperationPayload> _rail;
    private readonly ShellGatewayOptions _options;

    public ShellGatewayActor(
        IActorAddressResolver resolver,
        IResourceOperationInboxStore inboxStore,
        ShellGatewayOptions options,
        ICapabilityAdmissionClient? capabilityAuthority = null)
    {
        _rail = new ResourceGatewayRail<ShellExecuteOperationPayload>(Self, resolver, inboxStore, capabilityAuthority);
        _options = options;

        Receive<DeliveryAttemptOffer>(HandleOffer);
        Receive<ShellCapabilityCompleted>(HandleCapabilityCompleted);
        Receive<ShellCapabilityErrored>(errored =>
            _rail.Reject(errored.Started.DeliverySender, errored.Started.Offer, new OperationError("capability_admission_failed", errored.Exception.Message, true)));
        Receive<StartShellExecution>(message => SpawnShellWorker(message.Started));
        Receive<StartRecoveredShellExecution>(message => SpawnShellWorker(message.Recovered));
        Receive<ShellExecutionWorkerActor.StartedCompleted>(HandleShellExecutionCompleted);
        Receive<ShellExecutionWorkerActor.StartedErrored>(errored =>
            _rail.FailOperation(errored.Started, ResourceAddress, WorkerAddress, "shell_execution_failed", errored.Exception.Message));
        Receive<ShellExecutionWorkerActor.RecoveredCompleted>(HandleRecoveredShellExecutionCompleted);
        Receive<ShellExecutionWorkerActor.RecoveredErrored>(errored =>
            _rail.FailRecovered(errored.Recovered, ResourceAddress, WorkerAddress, "shell_execution_failed", errored.Exception.Message));
        Receive<ResourceGatewayRail<ShellExecuteOperationPayload>.RejectRecordedIntentMessage<ShellExecuteOperationPayload>>(_rail.HandleRejectedRecordedIntent);
        Receive<ResourceGatewayRail<ShellExecuteOperationPayload>.MarkProcessingMessage<ShellExecuteOperationPayload>>(_rail.HandleMarkProcessing);
        Receive<ShellStoreCommandFailed>(_rail.HandleStoreCommandFailed);
        Receive<RecoverableShellOperationsLoaded>(loaded => _rail.PrepareRecoveryBatch(loaded.Records, "invalid_shell_payload", prepared => new ShellRecoveryPreparedMessage(prepared)));
        Receive<ShellRecoveryPreparedMessage>(message =>
        {
            var next = _rail.HandlePreparedRecovery(message.Prepared, recovered => new StartRecoveredShellExecution(recovered));
            if (next is ResourceGatewayRail<ShellExecuteOperationPayload>.MarkProcessingMessage<ShellExecuteOperationPayload> markProcessing)
            {
                _rail.HandleMarkProcessing(markProcessing);
            }
        });
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
                "invalid_shell_payload",
                "Unsupported shell operation payload.",
                out var started)
            || started is null)
        {
            return;
        }

        if (!_rail.TryResolveCapabilityId(started, Descriptor.PayloadCapabilityId(started.Payload)?.Value, "shell operation", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _rail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "Shell capability id could not be resolved.", false));
            return;
        }

        var gateResult = _rail.StartCapabilityGate(
            resolvedStarted,
            resolvedStarted.InboxRecord.ResolvedCapabilityId,
            ResourceAddresses.Gateway(ResourceKinds.Shell),
            ResourceOperationTypes.ShellExecute,
            attributes: null,
            admission => new ShellCapabilityCompleted(resolvedStarted, admission),
            ex => new ShellCapabilityErrored(resolvedStarted, ex));

        if (gateResult == ShellCapabilityGateResult.Stopped)
        {
            return;
        }

        ContinueAfterRecording(resolvedStarted);
    }

    private void HandleCapabilityCompleted(ShellCapabilityCompleted completed)
    {
        if (completed.Admission is CapabilityRejected rejected)
        {
            _rail.Reject(completed.Started.DeliverySender, completed.Started.Offer, rejected.Error);
            return;
        }

        ContinueAfterRecording(completed.Started);
    }

    private void ContinueAfterRecording(ShellStarted started)
        => _rail.ContinueAfterRecordingAsync(started, pending => new StartShellExecution(pending));

    private void SpawnShellWorker(ShellStarted started)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new ShellExecutionWorkerActor(_options, Self)),
            $"shell-worker-{Guid.NewGuid():N}");
        worker.Tell(new ShellExecutionWorkerActor.ExecuteStarted(started), Self);
    }

    private void SpawnShellWorker(ShellRecovered recovered)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new ShellExecutionWorkerActor(_options, Self)),
            $"shell-worker-{Guid.NewGuid():N}");
        worker.Tell(new ShellExecutionWorkerActor.ExecuteRecovered(recovered), Self);
    }

    private void HandleShellExecutionCompleted(ShellExecutionWorkerActor.StartedCompleted completed)
    {
        _rail.Resolve(
            completed.Started,
            ResourceOperationTypes.ShellExecute,
            JsonSerializer.Serialize(completed.Result),
            ResourceAddress,
            WorkerAddress);
    }

    private void HandleRecoveredShellExecutionCompleted(ShellExecutionWorkerActor.RecoveredCompleted completed)
    {
        _rail.ResolveRecovered(
            completed.Recovered,
            ResourceOperationTypes.ShellExecute,
            JsonSerializer.Serialize(completed.Result),
            ResourceAddress,
            WorkerAddress);
    }

    private void RecoverPendingOperations()
        => _rail.ListRecoverableAsync(
            ResourceKinds.Shell,
            static records => new RecoverableShellOperationsLoaded(records),
            ex => new ShellStoreCommandFailed("list_recoverable", ResourceKinds.Shell, ex));
}
