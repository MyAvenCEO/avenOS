using Akka.Actor;
using Aven.Capabilities.Contracts.Models;
using Aven.Resources.Metadata.Contracts;
using Aven.Resources.Metadata.Gateways;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Metadata.Workers;

internal sealed class MetadataWriteWorkerActor : ReceiveActor
{
    public sealed record ExecuteStarted(ResourceGatewayRail<MetadataWriteOperationPayload>.Started Started);
    public sealed record ExecuteRecovered(ResourceGatewayRail<MetadataWriteOperationPayload>.Recovered Recovered);
    public sealed record StartedCompleted(ResourceGatewayRail<MetadataWriteOperationPayload>.Started Started, MetadataCreateReply Reply);
    public sealed record StartedErrored(ResourceGatewayRail<MetadataWriteOperationPayload>.Started Started, Exception Exception);
    public sealed record RecoveredCompleted(ResourceGatewayRail<MetadataWriteOperationPayload>.Recovered Recovered, MetadataCreateReply Reply);
    public sealed record RecoveredErrored(ResourceGatewayRail<MetadataWriteOperationPayload>.Recovered Recovered, Exception Exception);

    private readonly IActorRef _metadataActor;
    private readonly IActorRef? _schemaRegistryActor;
    private readonly IActorRef _gateway;

    public MetadataWriteWorkerActor(IActorRef metadataActor, IActorRef? schemaRegistryActor, IActorRef gateway)
    {
        _metadataActor = metadataActor;
        _schemaRegistryActor = schemaRegistryActor;
        _gateway = gateway;

        Receive<ExecuteStarted>(message => ExecuteStartedAsync(message.Started));
        Receive<ExecuteRecovered>(message => ExecuteRecoveredAsync(message.Recovered));
    }

    private void ExecuteStartedAsync(ResourceGatewayRail<MetadataWriteOperationPayload>.Started started)
    {
        var gateway = _gateway;
        var self = Self;
        var correlationId = started.Offer.Envelope.CorrelationId;
        _ = WriteMetadataAsync(started.Key, correlationId, started.Payload, started.InboxRecord.ResolvedCapabilityId)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StartedCompleted(started, task.Result)
                    : new StartedErrored(started, task.Exception?.GetBaseException() ?? new InvalidOperationException("Metadata write worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void ExecuteRecoveredAsync(ResourceGatewayRail<MetadataWriteOperationPayload>.Recovered recovered)
    {
        var gateway = _gateway;
        var self = Self;
        var correlationId = new CorrelationId(recovered.InboxRecord.CorrelationId);
        _ = WriteMetadataAsync(recovered.Key, correlationId, recovered.Payload, recovered.InboxRecord.ResolvedCapabilityId)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RecoveredCompleted(recovered, task.Result)
                    : new RecoveredErrored(recovered, task.Exception?.GetBaseException() ?? new InvalidOperationException("Metadata write worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private async Task<MetadataCreateReply> WriteMetadataAsync(OperationKey key, CorrelationId correlationId, MetadataWriteOperationPayload payload, string? resolvedCapabilityId)
    {
        if (_schemaRegistryActor is not null)
        {
            var validationReply = await _schemaRegistryActor.Ask<object>(new SchemaValidate(payload.SchemaRef, payload.Json), TimeSpan.FromSeconds(5));
            switch (validationReply)
            {
                case SchemaValidationSucceeded:
                    break;
                case SchemaValidationFailed failed:
                    return new MetadataCreateRejected(key, correlationId, new OperationError("metadata_schema_validation_failed", string.Join("; ", failed.Errors), false));
                case SchemaNotFound notFound:
                    return new MetadataCreateRejected(key, correlationId, new OperationError("metadata_schema_validation_failed", $"Schema not found: {notFound.SchemaRef.Value}", false));
                default:
                    return new MetadataCreateRejected(key, correlationId, new OperationError("metadata_schema_validation_failed", $"Unexpected schema validation reply: {validationReply.GetType().Name}", false));
            }
        }

        var subject = new MetadataSubject(
            payload.SubjectKind,
            payload.SubjectId,
            payload.ArtifactId is null ? null : new Aven.Toolkit.Core.Identifiers.ArtifactId(payload.ArtifactId.Value.Value),
            payload.ArtifactRevisionId is null ? null : new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId(payload.ArtifactRevisionId.Value.Value));

        return await _metadataActor.Ask<MetadataCreateReply>(
            new MetadataCreateCommand(
                new MetadataCreateRequest(
                    key,
                    correlationId,
                    subject,
                    payload.SchemaRef,
                    payload.Json,
                    payload.SourceSummary,
                    resolvedCapabilityId is { } capabilityId ? new CapabilityId(capabilityId) : null)),
            TimeSpan.FromSeconds(5));
    }
}
