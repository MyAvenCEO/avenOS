using Akka.Actor;
using Aven.Resources.Metadata.Contracts;
using Aven.Resources.Metadata.Gateways;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Metadata.Workers;

internal sealed class MetadataQueryWorkerActor : ReceiveActor
{
    private sealed record ForwardAndStop(object Message);

    public sealed record ExecuteStarted(ResourceGatewayRail<MetadataQueryOperationPayload>.Started Started);
    public sealed record ExecuteRecovered(ResourceGatewayRail<MetadataQueryOperationPayload>.Recovered Recovered);
    public sealed record StartedCompleted(ResourceGatewayRail<MetadataQueryOperationPayload>.Started Started, MetadataQueryResult Result);
    public sealed record StartedErrored(ResourceGatewayRail<MetadataQueryOperationPayload>.Started Started, Exception Exception);
    public sealed record RecoveredCompleted(ResourceGatewayRail<MetadataQueryOperationPayload>.Recovered Recovered, MetadataQueryResult Result);
    public sealed record RecoveredErrored(ResourceGatewayRail<MetadataQueryOperationPayload>.Recovered Recovered, Exception Exception);

    private readonly IActorRef _metadataActor;
    private readonly IActorRef _gateway;

    public MetadataQueryWorkerActor(IActorRef metadataActor, IActorRef gateway)
    {
        _metadataActor = metadataActor;
        _gateway = gateway;

        Receive<ForwardAndStop>(message =>
        {
            _gateway.Tell(message.Message, Self);
            Context.Stop(Self);
        });

        Receive<ExecuteStarted>(message => ExecuteStartedAsync(message.Started));
        Receive<ExecuteRecovered>(message => ExecuteRecoveredAsync(message.Recovered));
    }

    private void ExecuteStartedAsync(ResourceGatewayRail<MetadataQueryOperationPayload>.Started started)
    {
        var self = Self;
        _ = QueryMetadataAsync(started.Payload)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StartedCompleted(started, task.Result)
                    : new StartedErrored(started, task.Exception?.GetBaseException() ?? new InvalidOperationException("Metadata query worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteRecoveredAsync(ResourceGatewayRail<MetadataQueryOperationPayload>.Recovered recovered)
    {
        var self = Self;
        _ = QueryMetadataAsync(recovered.Payload)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RecoveredCompleted(recovered, task.Result)
                    : new RecoveredErrored(recovered, task.Exception?.GetBaseException() ?? new InvalidOperationException("Metadata query worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private async Task<MetadataQueryResult> QueryMetadataAsync(MetadataQueryOperationPayload payload)
    {
        var query = new MetadataQuery(
            Limit: payload.Limit,
            Timeout: TimeSpan.FromMilliseconds(payload.TimeoutMilliseconds),
            SubjectKinds: payload.SubjectKinds,
            SubjectIds: payload.SubjectIds,
            SchemaRefs: payload.SchemaRefs);
        return await _metadataActor.Ask<MetadataQueryResult>(new MetadataQueryCommand(query), TimeSpan.FromSeconds(5));
    }
}
