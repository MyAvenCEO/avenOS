using Akka.Actor;
using Aven.Resources.Llm;
using Aven.Resources.Llm.Contracts;
using Aven.Resources.Llm.Gateways;
using Aven.Resources.Runtime.Gateways;
using Aven.SchemaRegistry.Contracts.Models;

namespace Aven.Resources.Llm.Workers;

internal sealed class LlmStructuredGenerationWorkerActor : ReceiveActor
{
    private sealed record ForwardAndStop(object Message);

    private static readonly TimeSpan SchemaLookupTimeout = TimeSpan.FromSeconds(5);

    public sealed record ExecuteDirect(LlmStructuredGenerationCommand Command, IActorRef ReplyTo);
    public sealed record ExecuteStarted(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Started Started);
    public sealed record ExecuteRecovered(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Recovered Recovered);

    public sealed record DirectCompleted(IActorRef ReplyTo, OperationKey Key, CorrelationId CorrelationId, LlmResponse Response, string StructuredJson);
    public sealed record DirectErrored(IActorRef ReplyTo, OperationError Error);
    public sealed record StartedCompleted(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Started Started, LlmResponse Response, string StructuredJson);
    public sealed record StartedErrored(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Started Started, OperationError Error);
    public sealed record RecoveredCompleted(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Recovered Recovered, LlmResponse Response, string StructuredJson);
    public sealed record RecoveredErrored(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Recovered Recovered, OperationError Error);

    private readonly IActorRef _schemaRegistryActor;
    private readonly LlmExtractionPipeline _extractionPipeline;
    private readonly LlmModelCapabilities _defaultModel;
    private readonly IActorRef _gateway;

    public LlmStructuredGenerationWorkerActor(
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

        Receive<ExecuteDirect>(message => ExecuteDirectAsync(message.Command, message.ReplyTo));
        Receive<ExecuteStarted>(message => ExecuteStartedAsync(message.Started));
        Receive<ExecuteRecovered>(message => ExecuteRecoveredAsync(message.Recovered));
    }

    private void ExecuteDirectAsync(LlmStructuredGenerationCommand command, IActorRef replyTo)
    {
        var self = Self;
        _ = ExecuteStructuredGenerationAsync(command)
            .ContinueWith(
                task =>
                {
                    if (task.IsCompletedSuccessfully)
                    {
                        var key = new OperationKey(command.Caller, command.RequestId, ResourceOperationTypes.LlmStructuredGenerate);
                        return (object)new DirectCompleted(replyTo, key, command.CorrelationId, task.Result.Response, task.Result.StructuredJson);
                    }

                    return new DirectErrored(replyTo, ToStructuredGenerationError(task.Exception?.GetBaseException() ?? new InvalidOperationException("LLM structured generation worker failed.")));
                },
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteStartedAsync(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Started started)
    {
        var command = CreateStructuredGenerationCommand(started.Key, started.Offer.Envelope.CorrelationId, started.Payload, started.InboxRecord.ResolvedCapabilityId);
        var self = Self;
        _ = ExecuteStructuredGenerationAsync(command)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StartedCompleted(started, task.Result.Response, task.Result.StructuredJson)
                    : new StartedErrored(started, ToStructuredGenerationError(task.Exception?.GetBaseException() ?? new InvalidOperationException("LLM structured generation worker failed."))),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteRecoveredAsync(ResourceGatewayRail<LlmStructuredGenerateOperationPayload>.Recovered recovered)
    {
        var command = CreateStructuredGenerationCommand(recovered.Key, new CorrelationId(recovered.InboxRecord.CorrelationId), recovered.Payload, recovered.InboxRecord.ResolvedCapabilityId);
        var self = Self;
        _ = ExecuteStructuredGenerationAsync(command)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RecoveredCompleted(recovered, task.Result.Response, task.Result.StructuredJson)
                    : new RecoveredErrored(recovered, ToStructuredGenerationError(task.Exception?.GetBaseException() ?? new InvalidOperationException("LLM structured generation worker failed."))),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private LlmStructuredGenerationCommand CreateStructuredGenerationCommand(
        OperationKey key,
        CorrelationId correlationId,
        LlmStructuredGenerateOperationPayload payload,
        string? resolvedCapabilityId)
    {
        return new LlmStructuredGenerationCommand(
            key.RequestId,
            key.Caller,
            correlationId,
            ResolveModel(payload.Model),
            ConvertStructuredInput(payload.Input),
            payload.SchemaRef,
            payload.Purpose,
            new LlmReasoningOptions(payload.EnableReasoningSummary, payload.ThinkingBudget?.ToString()),
            new LlmBudgetLimits(payload.MaxCost, payload.MaxInputTokens, payload.MaxOutputTokens),
            new LlmSafetySettings(),
            string.IsNullOrWhiteSpace(resolvedCapabilityId) ? null : new CapabilityId(resolvedCapabilityId));
    }

    private LlmModelCapabilities ResolveModel(string? modelName) =>
        string.IsNullOrWhiteSpace(modelName)
            ? _defaultModel
            : _defaultModel with { ModelName = modelName! };

    private static IReadOnlyList<LlmInputBlock> ConvertStructuredInput(IReadOnlyList<LlmStructuredInputBlock> input) =>
        input.Select<LlmStructuredInputBlock, LlmInputBlock>(static block =>
        {
            var role = string.IsNullOrWhiteSpace(block.Role) ? "user" : block.Role!;
            if (string.Equals(block.Kind, "json", StringComparison.OrdinalIgnoreCase))
            {
                return new JsonInputBlock(block.Json ?? block.Text ?? "{}", role);
            }

            return new TextInputBlock(block.Text ?? block.Json ?? string.Empty, role);
        }).ToArray();

    private async Task<(LlmResponse Response, string StructuredJson)> ExecuteStructuredGenerationAsync(LlmStructuredGenerationCommand command)
    {
        var schemaReply = await _schemaRegistryActor.Ask<object>(new SchemaGet(command.SchemaRef), SchemaLookupTimeout);
        var schemaJson = schemaReply switch
        {
            SchemaRegistered registered => registered.JsonSchema,
            RegisteredSchema registered => registered.JsonSchema,
            SchemaNotFound notFound => throw new LlmProviderException(new OperationError("schema_not_found", $"Schema not found: {notFound.SchemaRef.Value}", false)),
            _ => throw new InvalidOperationException($"Unexpected schema lookup reply: {schemaReply.GetType().Name}")
        };

        var key = new OperationKey(command.Caller, command.RequestId, ResourceOperationTypes.LlmStructuredGenerate);
        var request = new LlmRequest(
            key,
            command.CorrelationId,
            ResourceAddresses.Gateway(ResourceKinds.Llm),
            new ActorAddress("reply/llm-structured-generation", "local"),
            command.Model,
            command.Input,
            new StructuredOutputContract(command.SchemaRef, schemaJson, false),
            Array.Empty<ProviderFileDescriptor>(),
            command.Reasoning,
            command.Budget,
            command.Safety,
            command.CapabilityId);

        var workerReply = await _extractionPipeline.ProcessStructuredAsync($"llm/structured/{command.RequestId.Value}", request);
        var success = workerReply switch
        {
            LlmRequestSucceededReply succeeded when !string.IsNullOrWhiteSpace(succeeded.Response.StructuredJson) => succeeded,
            LlmRequestRejectedReply rejected => throw new LlmProviderException(rejected.Error),
            LlmRequestFailedReply failed => throw new LlmProviderException(failed.Error),
            _ => throw new InvalidOperationException($"Unexpected LLM structured generation reply: {workerReply.GetType().Name}")
        };

        var structuredJson = success.Response.StructuredJson!;
        var validationReply = await _schemaRegistryActor.Ask<object>(new SchemaValidate(command.SchemaRef, structuredJson), SchemaLookupTimeout);
        return validationReply switch
        {
            SchemaValidationSucceeded => (success.Response, structuredJson),
            SchemaValidationFailed failed => throw new LlmProviderException(new OperationError("structured_output_invalid", string.Join("; ", failed.Errors), false)),
            SchemaNotFound notFound => throw new LlmProviderException(new OperationError("schema_not_found", $"Schema not found: {notFound.SchemaRef.Value}", false)),
            _ => throw new LlmProviderException(new OperationError("schema_validation_failed", $"Unexpected schema validation reply: {validationReply.GetType().Name}", false))
        };
    }

    private static OperationError ToStructuredGenerationError(Exception ex) =>
        ex is LlmProviderException provider
            ? provider.Error
            : new OperationError("llm_structured_generation_failed", ex.Message, false);
}
