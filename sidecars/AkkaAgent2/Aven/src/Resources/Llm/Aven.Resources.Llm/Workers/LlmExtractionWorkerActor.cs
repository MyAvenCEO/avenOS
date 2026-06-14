using Akka.Actor;
using Aven.Resources.Llm;
using Aven.Resources.Llm.Contracts;
using Aven.Resources.Llm.Gateways;
using Aven.Resources.Runtime.Gateways;
using Aven.SchemaRegistry.Contracts.Models;

namespace Aven.Resources.Llm.Workers;

internal sealed class LlmExtractionWorkerActor : ReceiveActor
{
    private sealed record ForwardAndStop(object Message);

    private static readonly TimeSpan SchemaLookupTimeout = TimeSpan.FromSeconds(5);

    public sealed record ExecuteStarted(ResourceGatewayRail<LlmGenerateOperationPayload>.Started Started);
    public sealed record ExecuteRecovered(ResourceGatewayRail<LlmGenerateOperationPayload>.Recovered Recovered);
    public sealed record StartedCompleted(ResourceGatewayRail<LlmGenerateOperationPayload>.Started Started, LlmExtractionResult Result);
    public sealed record StartedErrored(ResourceGatewayRail<LlmGenerateOperationPayload>.Started Started, Exception Exception);
    public sealed record RecoveredCompleted(ResourceGatewayRail<LlmGenerateOperationPayload>.Recovered Recovered, LlmExtractionResult Result);
    public sealed record RecoveredErrored(ResourceGatewayRail<LlmGenerateOperationPayload>.Recovered Recovered, Exception Exception);

    private readonly IActorRef _schemaRegistryActor;
    private readonly LlmExtractionPipeline _extractionPipeline;
    private readonly LlmModelCapabilities _defaultModel;
    private readonly IActorRef _gateway;

    public LlmExtractionWorkerActor(
        IActorRef schemaRegistryActor,
        LlmExtractionPipeline extractionPipeline,
        LlmModelCapabilities defaultModel,
        IActorRef gateway)
    {
        _schemaRegistryActor = schemaRegistryActor;
        _extractionPipeline = extractionPipeline;
        _defaultModel = defaultModel;
        _gateway = gateway;

        Receive<ForwardAndStop>(message =>
        {
            _gateway.Tell(message.Message, Self);
            Context.Stop(Self);
        });

        Receive<ExecuteStarted>(message => ExecuteStartedAsync(message.Started));
        Receive<ExecuteRecovered>(message => ExecuteRecoveredAsync(message.Recovered));
    }

    private void ExecuteStartedAsync(ResourceGatewayRail<LlmGenerateOperationPayload>.Started started)
    {
        var self = Self;
        _ = ExecuteAsync(started.Key, started.Offer.Envelope.CorrelationId, started.Payload, started.InboxRecord.ResolvedCapabilityId)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StartedCompleted(started, task.Result)
                    : new StartedErrored(started, task.Exception?.GetBaseException() ?? new InvalidOperationException("LLM extraction worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteRecoveredAsync(ResourceGatewayRail<LlmGenerateOperationPayload>.Recovered recovered)
    {
        var self = Self;
        _ = ExecuteAsync(recovered.Key, new CorrelationId(recovered.InboxRecord.CorrelationId), recovered.Payload, recovered.InboxRecord.ResolvedCapabilityId)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RecoveredCompleted(recovered, task.Result)
                    : new RecoveredErrored(recovered, task.Exception?.GetBaseException() ?? new InvalidOperationException("LLM extraction worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private async Task<LlmExtractionResult> ExecuteAsync(OperationKey key, CorrelationId correlationId, LlmGenerateOperationPayload payload, string? resolvedCapabilityId)
    {
        var request = await CreateExtractionRequestAsync(key, correlationId, payload, resolvedCapabilityId);
        return await _extractionPipeline.ExtractAsync($"api/llm/research/{payload.RequestId}", _schemaRegistryActor, request);
    }

    private async Task<LlmExtractionRequest> CreateExtractionRequestAsync(OperationKey key, CorrelationId correlationId, LlmGenerateOperationPayload payload, string? resolvedCapabilityId)
    {
        var schemaReply = await _schemaRegistryActor.Ask<object>(new SchemaGet(payload.SchemaRef), SchemaLookupTimeout);
        var schemaJson = schemaReply switch
        {
            SchemaRegistered registered => registered.JsonSchema,
            RegisteredSchema registered => registered.JsonSchema,
            SchemaNotFound => throw new InvalidOperationException($"Schema '{payload.SchemaRef.Value}' was not found."),
            _ => throw new InvalidOperationException($"Unexpected schema lookup reply: {schemaReply.GetType().Name}")
        };

        return new LlmExtractionRequest(
            key,
            correlationId,
            payload.Artifact,
            "api-runtime",
            _defaultModel,
            payload.Purpose,
            payload.SchemaRef,
            schemaJson,
            payload.Prompt,
            AllowTextFallback: false,
            PreferProviderFileUpload: true,
            resolvedCapabilityId is null ? null : new CapabilityId(resolvedCapabilityId));
    }
}
