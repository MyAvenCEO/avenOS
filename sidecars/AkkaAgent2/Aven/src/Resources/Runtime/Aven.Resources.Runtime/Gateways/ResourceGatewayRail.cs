using System.Text.Json;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Resources.Runtime.Gateways;

internal sealed class ResourceOperationInboxStoreCommandException : Exception
{
    public string OperationName { get; }
    public string? OperationKey { get; }

    public ResourceOperationInboxStoreCommandException(
        string operationName,
        string? operationKey,
        Exception inner)
        : base($"Resource operation inbox store command '{operationName}' failed for operation '{operationKey ?? "<none>"}'.", inner)
    {
        OperationName = operationName;
        OperationKey = operationKey;
    }
}

public sealed class ResourceGatewayRail<TPayload>
{
    internal const string AcceptanceKindRecorded = "resource_operation_recorded";

    public sealed record StoreCommandFailed(string OperationName, string? OperationKey, Exception Exception);

    public sealed record RecoveryPrepared(
        ResourceOperationInboxRecord Record,
        Recovered? Recovered,
        string? FailureCode,
        string? FailureMessage)
    {
        public bool CanStartWork => Recovered is not null;
    }

    public sealed record Started(
        string ResourceKind,
        DeliveryAttemptOffer Offer,
        IActorRef DeliverySender,
        IActorRef ReplyTarget,
        OperationKey Key,
        string OperationKeyText,
        TPayload Payload,
        ResourceOperationInboxRecord InboxRecord);

    public sealed record Recovered(
        string ResourceKind,
        IActorRef ReplyTarget,
        OperationKey Key,
        string OperationKeyText,
        TPayload Payload,
        ResourceOperationInboxRecord InboxRecord);

    public enum CapabilityGateResult
    {
        Proceed,
        Stopped
    }

    public enum ExecutionDisposition
    {
        StartWork,
        ResumeWork,
        AlreadyInFlight,
        AlreadyHandled
    }

    private readonly IActorRef _self;
    private readonly IActorAddressResolver _resolver;
    private readonly ICapabilityAdmissionClient? _capabilityAuthority;
    private readonly IResourceOperationInboxStore _inboxStore;
    private readonly CanonicalJsonSerializer _serializer = new();

    public ResourceGatewayRail(
        IActorRef self,
        IActorAddressResolver resolver,
        IResourceOperationInboxStore inboxStore,
        ICapabilityAdmissionClient? capabilityAuthority = null)
    {
        _self = self;
        _resolver = resolver;
        _inboxStore = inboxStore;
        _capabilityAuthority = capabilityAuthority;
    }

    public bool TryStart(
        DeliveryAttemptOffer offer,
        IActorRef deliverySender,
        string resourceKind,
        string operationKind,
        string invalidPayloadCode,
        string invalidPayloadMessage,
        Func<TPayload, string> requestIdFactory,
        Func<TPayload, string> operationTypeFactory,
        out Started? started)
    {
        started = null;

        if (!TryDeserialize(offer.Envelope.Payload, out TPayload? payload) || payload is null)
        {
            Reject(deliverySender, offer, new OperationError(invalidPayloadCode, invalidPayloadMessage, false));
            return false;
        }

        if (!_resolver.TryResolve(offer.Envelope.ReplyTo, out var replyTarget) || replyTarget is null)
        {
            Reject(deliverySender, offer, new OperationError("reply_target_unresolved", $"Agent reply target could not be resolved for {operationKind} completion.", true));
            return false;
        }

        var expectedMessageType = operationTypeFactory(payload);
        if (!string.Equals(offer.Envelope.MessageType, expectedMessageType, StringComparison.Ordinal))
        {
            Reject(
                deliverySender,
                offer,
                new OperationError(
                    "unsupported_operation_type",
                    $"Envelope message type '{offer.Envelope.MessageType}' is not supported for this {resourceKind} operation. Expected '{expectedMessageType}'.",
                    false));
            return false;
        }

        string payloadHash;
        try
        {
            payloadHash = _serializer.HashJson(offer.Envelope.Payload);
        }
        catch (Exception ex)
        {
            Reject(deliverySender, offer, new OperationError(invalidPayloadCode, ex.Message, false));
            return false;
        }

        var key = new OperationKey(offer.Envelope.Sender, new RequestId(requestIdFactory(payload)), expectedMessageType);
        var operationKeyText = FormatOperationKey(key);
        started = new Started(
            resourceKind,
            offer,
            deliverySender,
            replyTarget,
            key,
            operationKeyText,
            payload,
            new ResourceOperationInboxRecord(
                operationKeyText,
                key.Caller.Value,
                key.Caller.Protocol,
                key.RequestId.Value,
                key.OperationType,
                resourceKind,
                offer.Envelope.Recipient.Value,
                offer.Envelope.Recipient.Protocol,
                offer.Envelope.ReplyTo.Value,
                offer.Envelope.ReplyTo.Protocol,
                offer.Envelope.CorrelationId.Value,
                offer.Envelope.Payload,
                payloadHash,
                ResourceOperationInboxStatus.Recorded,
                DateTimeOffset.UtcNow,
                null,
                null,
                null,
                null,
                0,
                null));
        return true;
    }

    public bool TryStart(
        DeliveryAttemptOffer offer,
        IActorRef deliverySender,
        ResourceOperationDescriptor<TPayload> descriptor,
        string invalidPayloadCode,
        string invalidPayloadMessage,
        out Started? started)
    {
        started = null;

        if (descriptor is null)
        {
            throw new ArgumentNullException(nameof(descriptor));
        }

        if (!TryDeserialize(offer.Envelope.Payload, out TPayload? payload) || payload is null)
        {
            Reject(deliverySender, offer, new OperationError(invalidPayloadCode, invalidPayloadMessage, false));
            return false;
        }

        if (!_resolver.TryResolve(offer.Envelope.ReplyTo, out var replyTarget) || replyTarget is null)
        {
            Reject(deliverySender, offer, new OperationError("reply_target_unresolved", $"Agent reply target could not be resolved for {descriptor.ResourceKind} completion.", true));
            return false;
        }

        var expectedMessageType = descriptor.MessageType(payload);
        if (!string.Equals(offer.Envelope.MessageType, expectedMessageType, StringComparison.Ordinal))
        {
            Reject(
                deliverySender,
                offer,
                new OperationError(
                    "unsupported_operation_type",
                    $"Envelope message type '{offer.Envelope.MessageType}' is not supported for this {descriptor.ResourceKind} operation. Expected '{expectedMessageType}'.",
                    false));
            return false;
        }

        var validation = descriptor.Validate(payload);
        if (!validation.IsValid)
        {
            Reject(
                deliverySender,
                offer,
                new OperationError(
                    string.IsNullOrWhiteSpace(validation.ErrorCode) ? invalidPayloadCode : validation.ErrorCode,
                    string.IsNullOrWhiteSpace(validation.ErrorMessage) ? invalidPayloadMessage : validation.ErrorMessage,
                    false));
            return false;
        }

        string payloadHash;
        try
        {
            payloadHash = _serializer.HashJson(offer.Envelope.Payload);
        }
        catch (Exception ex)
        {
            Reject(deliverySender, offer, new OperationError(invalidPayloadCode, ex.Message, false));
            return false;
        }

        var key = descriptor.OperationKey(offer.Envelope.Sender, payload);
        var operationKeyText = FormatOperationKey(key);
        started = new Started(
            descriptor.ResourceKind,
            offer,
            deliverySender,
            replyTarget,
            key,
            operationKeyText,
            payload,
            new ResourceOperationInboxRecord(
                operationKeyText,
                key.Caller.Value,
                key.Caller.Protocol,
                key.RequestId.Value,
                key.OperationType,
                descriptor.ResourceKind,
                offer.Envelope.Recipient.Value,
                offer.Envelope.Recipient.Protocol,
                offer.Envelope.ReplyTo.Value,
                offer.Envelope.ReplyTo.Protocol,
                offer.Envelope.CorrelationId.Value,
                offer.Envelope.Payload,
                payloadHash,
                ResourceOperationInboxStatus.Recorded,
                DateTimeOffset.UtcNow,
                null,
                null,
                null,
                null,
                0,
                null));
        return true;
    }

    public CapabilityGateResult StartCapabilityGate(
        Started started,
        string? capabilityId,
        ActorAddress target,
        string messageType,
        IReadOnlyDictionary<string, string>? attributes,
        Func<object, object> completedFactory,
        Func<Exception, object> erroredFactory)
    {
        if (_capabilityAuthority is null)
        {
            return CapabilityGateResult.Proceed;
        }

        if (string.IsNullOrWhiteSpace(capabilityId))
        {
            Reject(
                started.DeliverySender,
                started.Offer,
                new OperationError("capability_required", $"{messageType} requires a capability id.", false));
            return CapabilityGateResult.Stopped;
        }

        var request = new CapabilityAdmissionRequest(
            new CapabilityId(capabilityId),
            started.Key,
            target,
            messageType,
            DateTimeOffset.UtcNow,
            attributes);

        _ = _capabilityAuthority.AdmitAsync(request)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? completedFactory(task.Result)
                    : erroredFactory(task.Exception?.GetBaseException() ?? new InvalidOperationException("Capability admission failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => _self.Tell(task.Result), TaskScheduler.Default);

        return CapabilityGateResult.Stopped;
    }

    public string? ResolveCapabilityId(string? payloadCapabilityId, CapabilityId? envelopeCapabilityId)
        => !string.IsNullOrWhiteSpace(payloadCapabilityId)
            ? payloadCapabilityId
            : envelopeCapabilityId?.Value;

    public bool TryResolveCapabilityId(
        Started started,
        string? payloadCapabilityId,
        string operationKind,
        out Started? resolved,
        out OperationError? rejection)
    {
        var envelopeCapabilityId = started.Offer.Envelope.CapabilityId?.Value;
        if (!string.IsNullOrWhiteSpace(payloadCapabilityId)
            && !string.IsNullOrWhiteSpace(envelopeCapabilityId)
            && !string.Equals(payloadCapabilityId, envelopeCapabilityId, StringComparison.Ordinal))
        {
            resolved = null;
            rejection = new OperationError(
                "capability_id_mismatch",
                $"{operationKind} capability id mismatch between payload and envelope.",
                false);
            return false;
        }

        var resolvedCapabilityId = ResolveCapabilityId(payloadCapabilityId, started.Offer.Envelope.CapabilityId);
        resolved = started with
        {
            InboxRecord = started.InboxRecord with
            {
                ResolvedCapabilityId = resolvedCapabilityId
            }
        };
        rejection = null;
        return true;
    }

    public string? ResolveCapabilityId(Started started, string? payloadCapabilityId)
        => ResolveCapabilityId(payloadCapabilityId, started.Offer.Envelope.CapabilityId);

    public void RecordIntentAsync(
        Started started,
        Func<Started, ResourceOperationInboxStore.RecordIntentResult, object> completedFactory,
        Func<Started, OperationError, object> rejectedFactory)
        => ContinueAsync(
            _inboxStore.RecordIntentAsync(started.InboxRecord),
            recorded => completedFactory(started, recorded),
            ex => rejectedFactory(started, ToRecordIntentError(ex)));

    public void ContinueAfterRecordingAsync(
        Started started,
        Func<Started, object> startWorkFactory,
        Func<Started, ResourceOperationInboxStore.RecordIntentResult, object>? alreadyHandledFactory = null)
        => RecordIntentAsync(
            started,
            (pending, result) => HandleRecordedIntent(pending, result, startWorkFactory, alreadyHandledFactory),
            static (pending, error) => new RejectRecordedIntentMessage<TPayload>(pending, error));

    public object HandleRecordedIntent(
        Started started,
        ResourceOperationInboxStore.RecordIntentResult recorded,
        Func<Started, object> startWorkFactory,
        Func<Started, ResourceOperationInboxStore.RecordIntentResult, object>? alreadyHandledFactory = null)
    {
        return AcceptRecordedIntent(started, recorded) switch
        {
            ExecutionDisposition.StartWork => CreateMarkProcessingMessage(started, startWorkFactory),
            ExecutionDisposition.ResumeWork => CreateMarkProcessingMessage(started, startWorkFactory),
            ExecutionDisposition.AlreadyInFlight => alreadyHandledFactory?.Invoke(started, recorded) ?? new NoOpMessage(),
            ExecutionDisposition.AlreadyHandled => alreadyHandledFactory?.Invoke(started, recorded) ?? new NoOpMessage(),
            _ => new NoOpMessage()
        };
    }

    public ExecutionDisposition AcceptRecordedIntent(Started started, ResourceOperationInboxStore.RecordIntentResult recorded)
    {
        Accept(started.DeliverySender, started.Offer, AcceptanceKindRecorded);

        return recorded.Disposition switch
        {
            ResourceOperationInboxStore.RecordIntentDisposition.Inserted => ExecutionDisposition.StartWork,
            ResourceOperationInboxStore.RecordIntentDisposition.AlreadyRecordedNonTerminal when recorded.Record.Status == ResourceOperationInboxStatus.Recorded => ExecutionDisposition.ResumeWork,
            ResourceOperationInboxStore.RecordIntentDisposition.AlreadyRecordedNonTerminal when recorded.Record.Status == ResourceOperationInboxStatus.Processing => ExecutionDisposition.AlreadyInFlight,
            ResourceOperationInboxStore.RecordIntentDisposition.AlreadyRecordedTerminal => ExecutionDisposition.AlreadyHandled,
            _ => throw new ArgumentOutOfRangeException(nameof(recorded), recorded.Disposition, "Unsupported inbox record disposition.")
        };
    }

    public void ListRecoverableAsync(
        string resourceKind,
        Func<IReadOnlyList<ResourceOperationInboxRecord>, object> completedFactory,
        Func<Exception, object> erroredFactory)
        => ContinueAsync(
            _inboxStore.ListRecoverableAsync(resourceKind),
            completedFactory,
            erroredFactory);

    public object PrepareRecoveryBatch(
        IReadOnlyList<ResourceOperationInboxRecord> records,
        string invalidPayloadCode,
        Func<RecoveryPrepared, object> preparedFactory)
    {
        foreach (var record in records)
        {
            _self.Tell(preparedFactory(PrepareRecovery(record, invalidPayloadCode)), _self);
        }

        return new NoOpMessage();
    }

    public object HandlePreparedRecovery(
        RecoveryPrepared prepared,
        Func<Recovered, object> startWorkFactory)
    {
        if (!prepared.CanStartWork)
        {
            MarkRecoveryFailedAsync(
                prepared.Record,
                prepared.FailureCode ?? "resource_recovery_failed",
                prepared.FailureMessage ?? "Resource operation recovery failed.");
            return new NoOpMessage();
        }

        return CreateMarkProcessingMessage(prepared.Recovered!, startWorkFactory);
    }

    public void HandleStoreCommandFailed(StoreCommandFailed failed)
    {
        throw new ResourceOperationInboxStoreCommandException(
            failed.OperationName,
            failed.OperationKey,
            failed.Exception);
    }

    public void HandleRejectedRecordedIntent(RejectRecordedIntentMessage<TPayload> rejected)
        => Reject(rejected.Started.DeliverySender, rejected.Started.Offer, rejected.Error);

    public RecoveryPrepared PrepareRecovery(ResourceOperationInboxRecord record, string invalidPayloadCode)
    {
        if (!TryDeserialize(record.PayloadJson, out TPayload? payload) || payload is null)
        {
            return new RecoveryPrepared(
                record,
                null,
                invalidPayloadCode,
                "Stored resource operation payload could not be deserialized during recovery.");
        }

        var replyTo = new ActorAddress(record.ReplyToValue, record.ReplyToProtocol);
        if (!_resolver.TryResolve(replyTo, out var replyTarget) || replyTarget is null)
        {
            return new RecoveryPrepared(
                record,
                null,
                "resource_owner_unresolved_after_recovery",
                $"Resource owner '{replyTo.Value}' could not be resolved during recovery.");
        }

        return new RecoveryPrepared(
            record,
            new Recovered(
                record.ResourceKind,
                replyTarget,
                new OperationKey(new ActorAddress(record.CallerValue, record.CallerProtocol), new RequestId(record.RequestId), record.OperationType),
                record.OperationKey,
                payload,
                record),
            null,
            null);
    }

    public void MarkRecoveryFailedAsync(ResourceOperationInboxRecord record, string code, string message)
        => MarkFailedAsync(record.OperationKey, code, message);

    public void MarkProcessingAsync(string operationKey, Func<object> completedFactory)
        => ContinueAsync(
            _inboxStore.MarkProcessingAsync(operationKey),
            _ => completedFactory(),
            ex => new StoreCommandFailed("mark_processing", operationKey, ex));

    public void MarkProcessingAsync(Started started, Func<object> completedFactory)
        => MarkProcessingAsync(started.OperationKeyText, completedFactory);

    public void MarkProcessingAsync(Recovered recovered, Func<object> completedFactory)
        => MarkProcessingAsync(recovered.OperationKeyText, completedFactory);

    public object CreateMarkProcessingMessage(Started started, Func<Started, object> completedFactory)
        => new MarkProcessingMessage<TPayload>(started.OperationKeyText, () => completedFactory(started));

    public object CreateMarkProcessingMessage(Recovered recovered, Func<Recovered, object> completedFactory)
        => new MarkProcessingMessage<TPayload>(recovered.OperationKeyText, () => completedFactory(recovered));

    public void HandleMarkProcessing(MarkProcessingMessage<TPayload> message)
        => MarkProcessingAsync(message.OperationKeyText, message.CompletedFactory);

    public void Reject(IActorRef deliverySender, DeliveryAttemptOffer offer, OperationError error) =>
        deliverySender.Tell(
            new DeliveryRejected(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, error),
            _self);

    public void Resolve(Started started, string operationValueKind, string responseJson, ActorAddress resourceAddress, ActorAddress workerAddress)
    {
        started.ReplyTarget.Tell(
            new OperationResolved(
                started.Key,
                started.Offer.Envelope.CorrelationId,
                resourceAddress,
                workerAddress,
                new OperationValue(operationValueKind, responseJson)),
            _self);
        MarkCompletedAsync(started.OperationKeyText);
    }

    public void ResolveRecovered(Recovered recovered, string operationValueKind, string responseJson, ActorAddress resourceAddress, ActorAddress workerAddress)
    {
        PublishResolvedRecovered(recovered, operationValueKind, responseJson, resourceAddress, workerAddress);
        MarkCompletedAsync(recovered.OperationKeyText);
    }

    public void PublishResolvedRecovered(Recovered recovered, string operationValueKind, string responseJson, ActorAddress resourceAddress, ActorAddress workerAddress)
    {
        recovered.ReplyTarget.Tell(
            new OperationResolved(
                recovered.Key,
                new CorrelationId(recovered.InboxRecord.CorrelationId),
                resourceAddress,
                workerAddress,
                new OperationValue(operationValueKind, responseJson)),
            _self);
    }

    public void FailOperation(Started started, ActorAddress resourceAddress, ActorAddress workerAddress, string code, string message, bool retryable = false)
    {
        started.ReplyTarget.Tell(
            new Aven.Contracts.Operations.OperationFailed(
                started.Key,
                started.Offer.Envelope.CorrelationId,
                resourceAddress,
                workerAddress,
                new OperationError(code, message, retryable)),
            _self);
        MarkFailedAsync(started.OperationKeyText, code, message);
    }

    public void FailRecovered(Recovered recovered, ActorAddress resourceAddress, ActorAddress workerAddress, string code, string message, bool retryable = false)
    {
        recovered.ReplyTarget.Tell(
            new Aven.Contracts.Operations.OperationFailed(
                recovered.Key,
                new CorrelationId(recovered.InboxRecord.CorrelationId),
                resourceAddress,
                workerAddress,
                new OperationError(code, message, retryable)),
            _self);
        MarkFailedAsync(recovered.OperationKeyText, code, message);
    }

    public void CancelRecovered(Recovered recovered, ActorAddress resourceAddress, ActorAddress workerAddress, string reason)
    {
        PublishCancelledRecovered(recovered, resourceAddress, workerAddress);
        MarkFailedAsync(recovered.OperationKeyText, "operation_cancelled", reason);
    }

    public void PublishCancelledRecovered(Recovered recovered, ActorAddress resourceAddress, ActorAddress workerAddress)
    {
        recovered.ReplyTarget.Tell(
            new OperationCancelled(
                recovered.Key,
                new CorrelationId(recovered.InboxRecord.CorrelationId),
                resourceAddress,
                workerAddress),
            _self);
    }

    public void TimeOutRecovered(Recovered recovered, ActorAddress resourceAddress, ActorAddress workerAddress, string code, string message, bool retryable)
    {
        PublishTimedOutRecovered(recovered, resourceAddress, workerAddress, code, message, retryable);
        MarkFailedAsync(recovered.OperationKeyText, code, message);
    }

    public void PublishTimedOutRecovered(Recovered recovered, ActorAddress resourceAddress, ActorAddress workerAddress, string code, string message, bool retryable)
    {
        recovered.ReplyTarget.Tell(
            new OperationTimedOut(
                recovered.Key,
                new CorrelationId(recovered.InboxRecord.CorrelationId),
                resourceAddress,
                workerAddress,
                new OperationError(code, message, retryable)),
            _self);
    }

    private void MarkCompletedAsync(string operationKey)
        => ContinueAsync(
            _inboxStore.MarkCompletedAsync(operationKey),
            _ => (object)new object(),
            ex => new StoreCommandFailed("mark_completed", operationKey, ex),
            suppressSuccessMessage: true);

    private void MarkFailedAsync(string operationKey, string code, string message)
        => ContinueAsync(
            _inboxStore.MarkFailedAsync(operationKey, code, message),
            _ => (object)new object(),
            ex => new StoreCommandFailed("mark_failed", operationKey, ex),
            suppressSuccessMessage: true);

    private void Accept(IActorRef deliverySender, DeliveryAttemptOffer offer, string acceptanceKind) =>
        deliverySender.Tell(
            new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, acceptanceKind),
            _self);

    private static bool TryDeserialize(string json, out TPayload? value)
    {
        try
        {
            value = JsonSerializer.Deserialize<TPayload>(json);
            return value is not null;
        }
        catch
        {
            value = default;
            return false;
        }
    }

    private static string FormatOperationKey(OperationKey key)
        => $"{key.Caller.Protocol}|{key.Caller.Value}|{key.RequestId.Value}|{key.OperationType}";

    private static OperationError ToRecordIntentError(Exception ex) =>
        ex switch
        {
            ResourceOperationInboxStore.ResourceOperationInboxPayloadTooLargeException => new OperationError("resource_operation_payload_too_large", "Resource operation payload exceeds inbox persistence limit.", false),
            ResourceOperationInboxStore.ResourceOperationInboxConflictException => new OperationError("resource_operation_conflict", "OperationKey was already used for a different resource payload.", false),
            _ => new OperationError("resource_operation_record_failed", ex.Message, true)
        };

    public sealed record MarkProcessingMessage<TInnerPayload>(string OperationKeyText, Func<object> CompletedFactory);
    public sealed record RejectRecordedIntentMessage<TInnerPayload>(Started Started, OperationError Error);
    public sealed record NoOpMessage;

    private void ContinueAsync<TResult>(
        Task<TResult> task,
        Func<TResult, object> completedFactory,
        Func<Exception, object> erroredFactory,
        bool suppressSuccessMessage = false)
    {
        _ = task
            .ContinueWith(
                completed =>
                {
                    if (!completed.IsCompletedSuccessfully)
                    {
                        return erroredFactory(completed.Exception?.GetBaseException() ?? new InvalidOperationException("Inbox operation failed."));
                    }

                    if (suppressSuccessMessage)
                    {
                        return null;
                    }

                    return completedFactory(completed.Result);
                },
                TaskScheduler.Default)
            .ContinueWith(
                continued =>
                {
                    if (continued.Result is not null)
                    {
                        _self.Tell(continued.Result, _self);
                    }
                },
                TaskScheduler.Default);
    }
}
