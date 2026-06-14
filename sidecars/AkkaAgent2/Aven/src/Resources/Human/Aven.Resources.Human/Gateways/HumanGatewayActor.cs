using Akka.Actor;
using Aven.Resources.Human;
using Aven.Resources.Human.Contracts.Enums;
using Aven.Resources.Human.Workers;
using Aven.Resources.Runtime.Gateways;
using System.Text.Json;
using Aven.Resources.Human.Contracts;

namespace Aven.Resources.Human.Gateways;

using HumanStarted = ResourceGatewayRail<HumanPromptOperationPayload>.Started;
using HumanRecovered = ResourceGatewayRail<HumanPromptOperationPayload>.Recovered;
using HumanRecordIntentResult = ResourceOperationInboxStore.RecordIntentResult;
using HumanRecoveryPrepared = ResourceGatewayRail<HumanPromptOperationPayload>.RecoveryPrepared;
using HumanStoreCommandFailed = ResourceGatewayRail<HumanPromptOperationPayload>.StoreCommandFailed;

public sealed class HumanGatewayActor : ReceiveActor
{
    private static readonly ActorAddress HumanGatewayAddress = ResourceAddresses.Gateway(ResourceKinds.Human);
    private static readonly ActorAddress WorkerAddress = ResourceAddresses.Worker(ResourceKinds.Human);

    private sealed record HumanIntentRecorded(HumanStarted Started, HumanRecordIntentResult Result);
    private sealed record HumanIntentRejected(HumanStarted Started, OperationError Error);
    private sealed record StartHumanRegistration(HumanStarted Started);
    private sealed record StartRecoveredHumanRegistration(HumanRecovered Recovered);
    private sealed record RecoverableHumanOperationsLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);
    private sealed record HumanRecoveryPreparedMessage(HumanRecoveryPrepared Prepared);
    private sealed record ReplayPendingTerminalReply(ResourceOperationInboxRecord Record);
    private sealed record MarkHumanPromptTerminalReplyDelivered(HumanPromptTerminalReplyReady Reply, HumanRecovered Recovered, IActorRef PromptActor);
    private sealed record MarkReplayedHumanPromptTerminalReplyDelivered(HumanRecovered Recovered);

    private readonly ResourceGatewayRail<HumanPromptOperationPayload> _rail;
    private readonly Func<HumanPromptRegistration, IActorRef> _promptFactory;
    private readonly IActorRef _registryActor;
    private readonly IResourceOperationInboxStore _inboxStore;
    private IActorRef? _terminalReplyStore;

    public HumanGatewayActor(
        Func<HumanPromptRegistration, IActorRef> promptFactory,
        IActorRef registryActor,
        IResourceOperationInboxStore inboxStore,
        IActorAddressResolver? resolver = null)
    {
        _promptFactory = promptFactory;
        _registryActor = registryActor;
        _inboxStore = inboxStore;
        _rail = new ResourceGatewayRail<HumanPromptOperationPayload>(Self, resolver ?? new PassthroughResolver(), inboxStore);

        Receive<HumanPromptRegistrationWorkerActor.StartedCompleted>(_ => { });
        Receive<HumanPromptRegistrationWorkerActor.StartedErrored>(failed =>
            _rail.FailOperation(failed.Started, HumanGatewayAddress, WorkerAddress, "human_prompt_registration_failed", failed.Exception.Message, true));
        Receive<HumanPromptRegistrationWorkerActor.RecoveredCompleted>(_ => { });
        Receive<HumanPromptRegistrationWorkerActor.RecoveredErrored>(failed =>
            _rail.FailRecovered(failed.Recovered, HumanGatewayAddress, WorkerAddress, "human_prompt_registration_failed", failed.Exception.Message, true));
        Receive<HumanIntentRecorded>(HandleHumanIntentRecorded);
        Receive<HumanIntentRejected>(rejected => _rail.Reject(rejected.Started.DeliverySender, rejected.Started.Offer, rejected.Error));
        Receive<StartHumanRegistration>(message => StartRegistrationAsync(message.Started));
        Receive<StartRecoveredHumanRegistration>(message => StartRegistrationAsync(message.Recovered));
        Receive<RecoverableHumanOperationsLoaded>(HandleRecoverableHumanOperationsLoaded);
        Receive<HumanRecoveryPreparedMessage>(HandleHumanRecoveryPrepared);
        Receive<HumanPromptTerminalReplyReady>(HandlePromptTerminalReplyReady);
        Receive<HumanTerminalReplyStoreWorkerActor.TerminalReplyLoaded>(HandlePromptTerminalReplyLoaded);
        Receive<HumanTerminalReplyStoreWorkerActor.TerminalReplyLoadFailed>(failed =>
            _rail.HandleStoreCommandFailed(new HumanStoreCommandFailed("get_terminal_reply_record", FormatOperationKey(failed.Reply.Key), failed.Exception)));
        Receive<HumanTerminalReplyStoreWorkerActor.TerminalReplyPendingRecorded>(HandlePromptTerminalReplyPendingRecorded);
        Receive<HumanTerminalReplyStoreWorkerActor.TerminalReplyDelivered>(HandlePromptTerminalReplyDelivered);
        Receive<HumanTerminalReplyStoreWorkerActor.TerminalReplyAlreadyDelivered>(HandlePromptTerminalReplyAlreadyDelivered);
        Receive<HumanTerminalReplyStoreWorkerActor.PendingTerminalRepliesLoaded>(HandlePendingTerminalRepliesLoaded);
        Receive<HumanTerminalReplyStoreWorkerActor.ReplayedTerminalReplyMarkedDelivered>(_ => { });
        Receive<ReplayPendingTerminalReply>(HandleReplayPendingTerminalReply);
        Receive<MarkHumanPromptTerminalReplyDelivered>(HandleMarkHumanPromptTerminalReplyDelivered);
        Receive<MarkReplayedHumanPromptTerminalReplyDelivered>(HandleMarkReplayedHumanPromptTerminalReplyDelivered);
        Receive<HumanStoreCommandFailed>(_rail.HandleStoreCommandFailed);
        Receive<DeliveryAttemptOffer>(HandleOffer);
        Receive<RecoverResourceOperations>(_ => RecoverPendingOperations());
    }

    protected override void PreStart()
    {
        RecoverPendingOperations();
        RecoverPendingTerminalReplies();
        base.PreStart();
    }

    private void HandleOffer(DeliveryAttemptOffer offer)
    {
        if (!_rail.TryStart(
                offer,
                Sender,
                ResourceKinds.Human,
                "human prompt",
                "invalid_human_payload",
                "Unsupported human prompt payload.",
                static payload => payload.RequestId,
                static _ => ResourceOperationTypes.HumanApprove,
                out var started)
            || started is null)
        {
            return;
        }

        if (!_rail.TryResolveCapabilityId(started, started.Payload.CapabilityId, "human prompt operation", out var resolvedStarted, out var capabilityError)
            || resolvedStarted is null)
        {
            _rail.Reject(started.DeliverySender, started.Offer, capabilityError ?? new OperationError("capability_id_invalid", "Human prompt capability id could not be resolved.", false));
            return;
        }

        ContinueAfterRecording(resolvedStarted);
    }

    private void ContinueAfterRecording(HumanStarted started)
        => _rail.RecordIntentAsync(
            started,
            static (pending, result) => new HumanIntentRecorded(pending, result),
            static (pending, error) => new HumanIntentRejected(pending, error));

    private void HandleHumanIntentRecorded(HumanIntentRecorded recorded)
    {
        switch (_rail.AcceptRecordedIntent(recorded.Started, recorded.Result))
        {
            case ResourceGatewayRail<HumanPromptOperationPayload>.ExecutionDisposition.StartWork:
            case ResourceGatewayRail<HumanPromptOperationPayload>.ExecutionDisposition.ResumeWork:
                _rail.MarkProcessingAsync(recorded.Started, () => new StartHumanRegistration(recorded.Started));
                break;
            case ResourceGatewayRail<HumanPromptOperationPayload>.ExecutionDisposition.AlreadyInFlight:
            case ResourceGatewayRail<HumanPromptOperationPayload>.ExecutionDisposition.AlreadyHandled:
            default:
                break;
        }
    }

    private void StartRegistrationAsync(HumanStarted started)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new HumanPromptRegistrationWorkerActor(_promptFactory, _registryActor, HumanGatewayAddress, Self)),
            $"human-registration-worker-{Guid.NewGuid():N}");
        worker.Tell(new HumanPromptRegistrationWorkerActor.ExecuteStarted(started), Self);
    }

    private void StartRegistrationAsync(HumanRecovered recovered)
    {
        var worker = Context.ActorOf(
            Props.Create(() => new HumanPromptRegistrationWorkerActor(_promptFactory, _registryActor, HumanGatewayAddress, Self)),
            $"human-registration-worker-{Guid.NewGuid():N}");
        worker.Tell(new HumanPromptRegistrationWorkerActor.ExecuteRecovered(recovered), Self);
    }

    private void RecoverPendingOperations()
        => _rail.ListRecoverableAsync(
            ResourceKinds.Human,
            static records => new RecoverableHumanOperationsLoaded(records),
            ex => new HumanStoreCommandFailed("list_recoverable", ResourceKinds.Human, ex));

    private void HandleRecoverableHumanOperationsLoaded(RecoverableHumanOperationsLoaded loaded)
    {
        foreach (var record in loaded.Records)
        {
            Self.Tell(new HumanRecoveryPreparedMessage(_rail.PrepareRecovery(record, "invalid_human_payload")));
        }
    }

    private void HandleHumanRecoveryPrepared(HumanRecoveryPreparedMessage message)
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
        _rail.MarkProcessingAsync(recovered, () => new StartRecoveredHumanRegistration(recovered));
    }

    private void HandlePromptTerminalReplyReady(HumanPromptTerminalReplyReady reply)
    {
        var promptActor = Sender;
        EnsureTerminalReplyStore().Tell(new HumanTerminalReplyStoreWorkerActor.LoadTerminalReply(reply, promptActor), Self);
    }

    private void HandlePromptTerminalReplyLoaded(HumanTerminalReplyStoreWorkerActor.TerminalReplyLoaded loaded)
    {
        if (loaded.Record is null)
        {
            throw new InvalidOperationException($"Human prompt terminal reply could not be matched to inbox row '{FormatOperationKey(loaded.Reply.Key)}'.");
        }

        if (!IsValidTerminalReplyIdentity(loaded.Record, loaded.Reply, out var recovered, out var prepared))
        {
            return;
        }

        EnsureTerminalReplyStore().Tell(new HumanTerminalReplyStoreWorkerActor.RecordTerminalReplyPending(loaded.Reply, recovered, loaded.PromptActor), Self);
    }

    private void HandlePromptTerminalReplyPendingRecorded(HumanTerminalReplyStoreWorkerActor.TerminalReplyPendingRecorded recorded)
    {
        PublishTerminalReply(recorded.Recovered, recorded.PendingRecord);
        Self.Tell(new MarkHumanPromptTerminalReplyDelivered(recorded.Reply, recorded.Recovered, recorded.PromptActor));
    }

    private void HandleMarkHumanPromptTerminalReplyDelivered(MarkHumanPromptTerminalReplyDelivered message)
    {
        EnsureTerminalReplyStore().Tell(new HumanTerminalReplyStoreWorkerActor.MarkTerminalReplyDelivered(message.Reply, message.Recovered, message.PromptActor), Self);
    }

    private void HandlePromptTerminalReplyDelivered(HumanTerminalReplyStoreWorkerActor.TerminalReplyDelivered delivered)
    {
        delivered.PromptActor.Tell(new HumanPromptTerminalReplyAcknowledged(delivered.Reply.PromptId), Self);
    }

    private void HandlePromptTerminalReplyAlreadyDelivered(HumanTerminalReplyStoreWorkerActor.TerminalReplyAlreadyDelivered delivered)
    {
        delivered.PromptActor.Tell(new HumanPromptTerminalReplyAcknowledged(delivered.Reply.PromptId), Self);
    }

    private void RecoverPendingTerminalReplies()
        => EnsureTerminalReplyStore().Tell(new HumanTerminalReplyStoreWorkerActor.ListPendingTerminalReplies(), Self);

    private void HandlePendingTerminalRepliesLoaded(HumanTerminalReplyStoreWorkerActor.PendingTerminalRepliesLoaded loaded)
    {
        foreach (var record in loaded.Records)
        {
            Self.Tell(new ReplayPendingTerminalReply(record));
        }
    }

    private void HandleReplayPendingTerminalReply(ReplayPendingTerminalReply message)
    {
        var prepared = _rail.PrepareRecovery(message.Record, "invalid_human_payload");
        if (!prepared.CanStartWork)
        {
            _rail.MarkRecoveryFailedAsync(
                prepared.Record,
                prepared.FailureCode ?? "resource_recovery_failed",
                prepared.FailureMessage ?? "Resource operation recovery failed.");
            return;
        }

        var recovered = prepared.Recovered!;
        if (message.Record.TerminalReplyDeliveryStatus is not ResourceOperationTerminalReplyDeliveryStatus.Pending
            || string.IsNullOrWhiteSpace(message.Record.TerminalReplyKind)
            || string.IsNullOrWhiteSpace(message.Record.TerminalReplyPayloadJson))
        {
            throw new InvalidOperationException($"Pending human terminal reply replay requires stored pending delivery data for '{recovered.OperationKeyText}'.");
        }

        PublishTerminalReply(recovered, message.Record);
        Self.Tell(new MarkReplayedHumanPromptTerminalReplyDelivered(recovered));
    }

    private void HandleMarkReplayedHumanPromptTerminalReplyDelivered(MarkReplayedHumanPromptTerminalReplyDelivered message)
    {
        EnsureTerminalReplyStore().Tell(new HumanTerminalReplyStoreWorkerActor.MarkReplayedTerminalReplyDelivered(message.Recovered), Self);
    }

    private bool IsValidTerminalReplyIdentity(
        ResourceOperationInboxRecord record,
        HumanPromptTerminalReplyReady reply,
        out HumanRecovered recovered,
        out HumanRecoveryPrepared prepared)
    {
        prepared = _rail.PrepareRecovery(record, "invalid_human_payload");
        recovered = default!;
        if (!string.Equals(record.ResourceKind, ResourceKinds.Human, StringComparison.Ordinal)
            || !string.Equals(record.OperationKey, FormatOperationKey(reply.Key), StringComparison.Ordinal)
            || !string.Equals(record.RequestId, reply.Key.RequestId.Value, StringComparison.Ordinal)
            || reply.PromptId != HumanPromptIdentity.FromOperationKey(reply.Key)
            || !string.Equals(NormalizeCapabilityId(record.ResolvedCapabilityId), NormalizeCapabilityId(reply.ResolvedCapabilityId), StringComparison.Ordinal))
        {
            return false;
        }

        if (!prepared.CanStartWork)
        {
            return false;
        }

        recovered = prepared.Recovered!;
        return recovered.Key == reply.Key
               && string.Equals(recovered.Payload.RequestId, reply.Key.RequestId.Value, StringComparison.Ordinal)
               && !recovered.ReplyTarget.IsNobody();
    }

    private IActorRef EnsureTerminalReplyStore()
    {
        if (_terminalReplyStore is not null)
        {
            return _terminalReplyStore;
        }

        _terminalReplyStore = Context.ActorOf(
            Props.Create(() => new HumanTerminalReplyStoreWorkerActor(_inboxStore, Self)),
            "human-terminal-reply-store");
        return _terminalReplyStore;
    }

    private void PublishTerminalReply(HumanRecovered recovered, ResourceOperationInboxRecord pending)
    {
        switch (pending.TerminalReplyKind)
        {
            case "resolved":
                {
                    using var document = JsonDocument.Parse(pending.TerminalReplyPayloadJson!);
                    var root = document.RootElement;
                    var operationValueKind = root.GetProperty("kind").GetString() ?? ResourceOperationTypes.HumanAnswer;
                    var responseJson = JsonSerializer.Serialize(new
                    {
                        promptId = root.GetProperty("promptId").GetString(),
                        answer = root.TryGetProperty("answer", out var answer) ? answer.GetString() : null,
                        answeredAt = root.TryGetProperty("answeredAt", out var answeredAt) && answeredAt.ValueKind != JsonValueKind.Null
                            ? answeredAt.GetDateTimeOffset()
                            : (DateTimeOffset?)null
                    });

                    _rail.PublishResolvedRecovered(recovered, operationValueKind, responseJson, HumanGatewayAddress, WorkerAddress);
                    break;
                }
            case "cancelled":
                _rail.PublishCancelledRecovered(recovered, HumanGatewayAddress, WorkerAddress);
                break;
            case "timed_out":
                {
                    using var document = JsonDocument.Parse(pending.TerminalReplyPayloadJson!);
                    var errorElement = document.RootElement.GetProperty("error");
                    var error = JsonSerializer.Deserialize<OperationError>(errorElement.GetRawText())
                        ?? new OperationError(pending.LastErrorCode ?? "human_prompt_expired", pending.LastErrorMessage ?? "Human prompt expired.", false);

                    _rail.PublishTimedOutRecovered(recovered, HumanGatewayAddress, WorkerAddress, error.Code, error.Message, error.Retryable);
                    break;
                }
            default:
                throw new InvalidOperationException($"Unsupported terminal reply kind '{pending.TerminalReplyKind}'.");
        }
    }

    private static string NormalizeCapabilityId(string? capabilityId)
        => string.IsNullOrWhiteSpace(capabilityId) ? string.Empty : capabilityId;

    private static string FormatOperationKey(OperationKey key)
        => $"{key.Caller.Protocol}|{key.Caller.Value}|{key.RequestId.Value}|{key.OperationType}";

    private sealed class PassthroughResolver : IActorAddressResolver
    {
        public bool TryResolve(ActorAddress address, out IActorRef? actorRef)
        {
            actorRef = ActorRefs.Nobody;
            return true;
        }

        public IActorRef Resolve(ActorAddress address) => ActorRefs.Nobody;
    }
}
