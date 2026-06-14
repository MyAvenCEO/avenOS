using Akka.Actor;
using Akka.Persistence;
using Aven.ActorKernel;
using Aven.Contracts.Protocol;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Resources.Llm.Actors;

public sealed class LlmRequestWorkerActor : AvenPersistentActor
{
    // Recovery contract: this worker is parent-reconstructed, not self-sufficient from LlmRequestRegistered.
    // LlmRequestRegistered is a bounded trace/summary event and intentionally omits raw prompts, schemas,
    // inline artifact bytes, and provider transport payloads. Any parent/gateway recreating this actor after
    // restart must pass the same LlmRequest constructor argument for validation, reply creation, and provider calls.
    private readonly LlmRequest _request;
    private readonly ILlmProvider _provider;
    private readonly LlmRequestId _llmRequestId;
    private LlmRequestState _state;
    private bool _registrationPersisted;
    private IActorRef? _pendingReplyTo;
    private static readonly CanonicalJsonSerializer Serializer = new();

    public LlmRequestWorkerActor(
        string persistenceId,
        LlmRequest request,
        ILlmProvider provider)
    {
        PersistenceId = persistenceId;
        _request = request;
        _provider = provider;
        _llmRequestId = CreateLlmRequestId(request.Key);
        _state = LlmRequestState.Create(request);

        Command<InitializeLlmRequestWorker>(_ => EnsureRegistered(null));

        Command<LlmProcessRequest>(_ =>
        {
            var replyTo = Sender;
            EnsureRegistered(() => HandleProcessRequest(replyTo));
        });
        Command<LlmProviderCallCompleted>(HandleProviderCallCompleted);
        Command<LlmProviderCallFailed>(HandleProviderCallFailed);
        Command<LlmInspect>(_ => Sender.Tell(_state));

        RecoverEvent<LlmRequestRegistered>(_ =>
        {
            _registrationPersisted = true;
            _state = LlmRequestState.Create(_request);
        });
        RecoverEvent<LlmExternalCallStarted>(_ => _state = _state with { Status = LlmRequestStatus.Running, ExternalCallStarted = true });
        RecoverEvent<LlmStructuredOutputValidated>(_ => { });
        RecoverEvent<LlmRequestSucceeded>(e => _state = _state with { Status = LlmRequestStatus.Succeeded, Response = RehydrateResponse(e), Error = null });
        RecoverEvent<LlmRequestRejectedByPolicy>(e => _state = _state with { Status = LlmRequestStatus.Rejected, Error = e.Error });
        RecoverEvent<LlmRequestFailed>(e => _state = _state with { Status = LlmRequestStatus.Failed, Error = e.Error });
        Recover<RecoveryCompleted>(_ =>
        {
            if (!_registrationPersisted)
            {
                Self.Tell(new InitializeLlmRequestWorker());
            }

            if (_state.ExternalCallStarted && _state.Status == LlmRequestStatus.Running)
            {
                var executionStrategy = DescribeExecutionStrategy();
                if (WorkerRecoveryPolicy.CanRecoverUnknownExternalCall(executionStrategy.RecoverableAfterRestart, _request.Model.SupportsRecoveryPolling))
                {
                    StartExternalCall();
                }
                else
                {
                    var failed = new LlmRequestFailed(_llmRequestId, _request.Key, new OperationError(
                        "recovery_incomplete",
                        "The LLM external call was in-flight at crash time and the provider cannot recover unknown completion safely.",
                        false));
                    PersistEvent(failed, RequestMetadataFor<LlmRequestFailed>(failed, failed.Error),
                        e => _state = _state with { Status = LlmRequestStatus.Failed, Error = e.Error });
                }
            }
        });
    }

    public override string PersistenceId { get; }

    private void HandleProcessRequest(IActorRef replyTo)
    {
        if (_state.Status is LlmRequestStatus.Succeeded or LlmRequestStatus.Rejected or LlmRequestStatus.Failed)
        {
            replyTo.Tell(CreateReply());
            return;
        }

        HandleProcessRequestAfterAdmission(replyTo);
    }

    private void HandleProcessRequestAfterAdmission(IActorRef replyTo)
    {
        if (_state.Status is LlmRequestStatus.Succeeded or LlmRequestStatus.Rejected or LlmRequestStatus.Failed)
        {
            replyTo.Tell(CreateReply());
            return;
        }

        var validationError = ValidateRequest();
        if (validationError is not null)
        {
            PersistRejectedByPolicy(replyTo, validationError);
            return;
        }

        var executionStrategy = DescribeExecutionStrategy();
        if (executionStrategy.StartExternalCallWithoutImmediateProviderExecution)
        {
            var started = new LlmExternalCallStarted(_llmRequestId, _request.Key, DateTimeOffset.UtcNow);
            PersistEvent(started, RequestMetadataFor<LlmExternalCallStarted>(started, started, occurredAt: started.StartedAt), _ =>
            {
                _state = _state with { Status = LlmRequestStatus.Running, ExternalCallStarted = true };
                replyTo.Tell(new LlmRequestFailedReply(
                    _request.Key,
                    _request.CorrelationId,
                    executionStrategy.InFlightReplyError ?? new OperationError("in_flight_started", "External call started and remains in-flight.", true)));
            });
            return;
        }

        var startedEvent = new LlmExternalCallStarted(_llmRequestId, _request.Key, DateTimeOffset.UtcNow);
        PersistEvent(startedEvent, RequestMetadataFor<LlmExternalCallStarted>(startedEvent, startedEvent, occurredAt: startedEvent.StartedAt), _ =>
        {
            _state = _state with { Status = LlmRequestStatus.Running, ExternalCallStarted = true };
            StartExternalCall(replyTo);
        });
    }

    private void PersistRejectedByPolicy(IActorRef replyTo, OperationError error)
    {
        var evt = new LlmRequestRejectedByPolicy(_llmRequestId, _request.Key, error);
        PersistEvent(evt, RequestMetadataFor<LlmRequestRejectedByPolicy>(evt, evt.Error), e =>
        {
            _state = _state with { Status = LlmRequestStatus.Rejected, Error = e.Error };
            replyTo.Tell(new LlmRequestRejectedReply(_request.Key, _request.CorrelationId, e.Error));
        });
    }

    private void EnsureRegistered(Action? afterRegistered)
    {
        if (_registrationPersisted)
        {
            afterRegistered?.Invoke();
            return;
        }

        var evt = new LlmRequestRegistered(
            _llmRequestId,
            _request.Key,
            _request.CorrelationId,
            _request.Adapter,
            _request.ReplyTo,
            _provider.Name,
            _request.Model.ModelName,
            _request.Input.Select(CreateInputSummary).ToArray(),
            _request.StructuredOutput is null
                ? null
                : new LlmStructuredOutputSummary(
                    _request.StructuredOutput.SchemaRef,
                    Serializer.Hash(_request.StructuredOutput.JsonSchema),
                    _request.StructuredOutput.Strict),
            _request.ProviderFiles.Select(file => file.ProviderFileKey).ToArray(),
            _request.Reasoning,
            _request.Budget,
            _request.Safety,
            _request.CapabilityId);
        PersistEvent(evt, MetadataFor<LlmRequestRegistered>(
            RequestActorAddress(),
            nameof(LlmRequestWorkerActor),
            _request.CorrelationId,
            evt,
            operationKey: _request.Key), _ =>
        {
            _registrationPersisted = true;
            _state = LlmRequestState.Create(_request);
            afterRegistered?.Invoke();
        });
    }

    private void StartExternalCall(IActorRef? replyTo = null)
    {
        _pendingReplyTo = replyTo;
        var self = Self;

        _ = Task.Run(async () =>
        {
            try
            {
                var response = await _provider.ExecuteAsync(_request).ConfigureAwait(false);
                self.Tell(new LlmProviderCallCompleted(response));
            }
            catch (LlmProviderException ex)
            {
                self.Tell(new LlmProviderCallFailed(ex.Error));
            }
            catch (Exception ex)
            {
                self.Tell(new LlmProviderCallFailed(new OperationError("llm_execution_failed", ex.Message, false)));
            }
        });
    }

    private void HandleProviderCallCompleted(LlmProviderCallCompleted completed)
    {
        var validationEvent = CreateStructuredOutputValidationEvent(completed.Response);
        if (validationEvent is not null)
        {
            PersistEvent(validationEvent, RequestMetadataFor<LlmStructuredOutputValidated>(validationEvent), _ => { });
        }

        var evt = new LlmRequestSucceeded(
            _llmRequestId,
            _request.Key,
            completed.Response.Provider,
            completed.Response.Model,
            completed.Response.Text,
            completed.Response.StructuredJson,
            completed.Response.ToolCalls.ToArray(),
            completed.Response.Refusal,
            completed.Response.SafetyBlock,
            completed.Response.ReasoningSummary,
            completed.Response.Citations.ToArray(),
            completed.Response.SchemaRef,
            completed.Response.StructuredOutputValidated,
            completed.Response.FinishReason,
            completed.Response.Usage.PromptTokens,
            completed.Response.Usage.CompletionTokens,
            completed.Response.Usage.Cost,
            completed.Response.Degradations.ToArray());
        PersistEvent(evt, RequestMetadataFor<LlmRequestSucceeded>(evt), e =>
        {
            var response = RehydrateResponse(e);
            _state = _state with { Status = LlmRequestStatus.Succeeded, Response = response, Error = null };
            _pendingReplyTo?.Tell(new LlmRequestSucceededReply(_request.Key, _request.CorrelationId, response));
            _pendingReplyTo = null;
        });
    }

    private void HandleProviderCallFailed(LlmProviderCallFailed failed)
    {
        var evt = new LlmRequestFailed(_llmRequestId, _request.Key, failed.Error);
        PersistEvent(evt, RequestMetadataFor<LlmRequestFailed>(evt, evt.Error), e =>
        {
            _state = _state with { Status = LlmRequestStatus.Failed, Error = e.Error };
            _pendingReplyTo?.Tell(new LlmRequestFailedReply(_request.Key, _request.CorrelationId, e.Error));
            _pendingReplyTo = null;
        });
    }

    private object CreateReply() => _state.Status switch
    {
        LlmRequestStatus.Succeeded when _state.Response is not null => new LlmRequestSucceededReply(_request.Key, _request.CorrelationId, _state.Response),
        LlmRequestStatus.Rejected when _state.Error is not null => new LlmRequestRejectedReply(_request.Key, _request.CorrelationId, _state.Error),
        LlmRequestStatus.Failed when _state.Error is not null => new LlmRequestFailedReply(_request.Key, _request.CorrelationId, _state.Error),
        _ => _state
    };

    private LlmStructuredOutputValidated? CreateStructuredOutputValidationEvent(LlmResponse response)
    {
        if (_request.StructuredOutput is not { } contract || string.IsNullOrWhiteSpace(response.StructuredJson))
        {
            return null;
        }

        return new LlmStructuredOutputValidated(
            _llmRequestId,
            _request.Key,
            contract.SchemaRef,
            response.StructuredOutputValidated,
            Array.Empty<string>());
    }

    private LlmResponse RehydrateResponse(LlmRequestSucceeded evt)
    {
        var usage = new LlmUsage(
            evt.PromptTokens,
            evt.CompletionTokens,
            evt.PromptTokens + evt.CompletionTokens,
            evt.Cost);

        return new LlmResponse(
            evt.Provider,
            evt.Model,
            evt.Text,
            evt.StructuredJson,
            evt.ToolCalls,
            evt.Refusal,
            evt.SafetyBlock,
            evt.ReasoningSummary,
            evt.Citations,
            usage,
            evt.FinishReason,
            evt.Degradations,
            evt.SchemaRef,
            evt.StructuredOutputValidated);
    }

    private static LlmInputBlockSummary CreateInputSummary(LlmInputBlock block) => block switch
    {
        TextInputBlock text => new LlmInputBlockSummary(block.Kind, Role: text.Role, PayloadHash: Serializer.Hash(text.Text)),
        JsonInputBlock json => new LlmInputBlockSummary(block.Kind, Role: json.Role, PayloadHash: Serializer.Hash(json.Json)),
        ArtifactInputBlock artifact => new LlmInputBlockSummary(block.Kind, ArtifactId: artifact.ArtifactId, MimeType: artifact.MimeType, PayloadHash: string.IsNullOrWhiteSpace(artifact.InlineTransportData) ? null : Serializer.Hash(artifact.InlineTransportData)),
        ProviderFileInputBlock providerFile => new LlmInputBlockSummary(block.Kind, ProviderFileKey: providerFile.ProviderFileKey, Purpose: providerFile.Purpose, TransportMode: providerFile.TransportMode),
        ToolDefinitionInputBlock tool => new LlmInputBlockSummary(block.Kind, PayloadHash: Serializer.Hash(tool.JsonSchema), Name: tool.Name),
        ToolResultInputBlock toolResult => new LlmInputBlockSummary(block.Kind, PayloadHash: Serializer.Hash(toolResult.ResultJson), Name: toolResult.ToolName),
        _ => new LlmInputBlockSummary(block.Kind)
    };

    private ActorAddress RequestActorAddress() => new($"llm-request/{Sanitize(_request.Key.ToString())}", "local");

    private static LlmRequestId CreateLlmRequestId(OperationKey key) =>
        new($"llm-{Sanitize(key.Caller.Value)}-{Sanitize(key.RequestId.Value)}-{Sanitize(key.OperationType)}");

    private LlmExecutionStrategy DescribeExecutionStrategy() =>
        (_provider as ILlmExecutionStrategyProvider)?.DescribeExecutionStrategy(_request)
        ?? LlmExecutionStrategy.Immediate;

    private EventMetadata RequestMetadataFor<TEvent>(object? payloadForHash = null, object? metadataPayload = null, DateTimeOffset? occurredAt = null)
        where TEvent : IAvenEvent =>
        MetadataFor<TEvent>(
            RequestActorAddress(),
            nameof(LlmRequestWorkerActor),
            _request.CorrelationId,
            metadataPayload ?? payloadForHash,
            operationKey: _request.Key,
            occurredAt: occurredAt);

    private OperationError? ValidateRequest()
    {
        foreach (var block in _request.Input)
        {
            switch (block)
            {
                case ArtifactInputBlock { ArtifactKind: LlmBlockKind.DocumentArtifact } when !_request.Model.SupportsPdfArtifacts:
                    return new OperationError("unsupported_document_artifact", "Model does not support document/PDF artifact input.", false);
                case ArtifactInputBlock { ArtifactKind: LlmBlockKind.ImageArtifact } when !_request.Model.SupportsImages:
                    return new OperationError("unsupported_image_artifact", "Model does not support image artifact input.", false);
                case ProviderFileInputBlock when !_request.Model.SupportsProviderFiles:
                    return new OperationError("unsupported_provider_file", "Model does not support provider file references.", false);
                case ToolDefinitionInputBlock when !_request.Model.SupportsToolCalls:
                    return new OperationError("unsupported_tool_calls", "Model does not support tool definitions or tool calls.", false);
            }
        }

        return null;
    }
}
