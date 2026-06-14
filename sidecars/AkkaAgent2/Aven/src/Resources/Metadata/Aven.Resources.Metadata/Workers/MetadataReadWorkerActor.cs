using Akka.Actor;
using Aven.Resources.Metadata.Gateways;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Metadata.Workers;

internal sealed class MetadataReadWorkerActor : ReceiveActor
{
    private sealed record ForwardAndStop(object Message);

    public sealed record ExecuteQuery(MetadataGatewayQueryCommand Command, IActorRef ReplyTo);
    public sealed record ExecuteInspectAll(MetadataGatewayInspectAllCommand Command, IActorRef ReplyTo);
    public sealed record QueryCompleted(MetadataQueryResult Result, IActorRef ReplyTo);
    public sealed record QueryErrored(Exception Exception, IActorRef ReplyTo);
    public sealed record InspectAllCompleted(MetadataRecord[] Records, IActorRef ReplyTo);
    public sealed record InspectAllErrored(Exception Exception, IActorRef ReplyTo);

    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    private readonly IActorRef _metadataActor;
    private readonly IActorRef _gateway;

    public MetadataReadWorkerActor(IActorRef metadataActor, IActorRef gateway)
    {
        _metadataActor = metadataActor;
        _gateway = gateway;

        Receive<ForwardAndStop>(message =>
        {
            _gateway.Tell(message.Message, Self);
            Context.Stop(Self);
        });

        Receive<ExecuteQuery>(message => ExecuteQueryAsync(message.Command, message.ReplyTo));
        Receive<ExecuteInspectAll>(message => ExecuteInspectAllAsync(message.Command, message.ReplyTo));
    }

    private void ExecuteQueryAsync(MetadataGatewayQueryCommand command, IActorRef replyTo)
    {
        var self = Self;
        _ = _metadataActor.Ask<MetadataQueryResult>(new MetadataQueryCommand(command.Query), DefaultTimeout)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new QueryCompleted(task.Result, replyTo)
                    : new QueryErrored(task.Exception?.GetBaseException() ?? new InvalidOperationException("Metadata query failed."), replyTo),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteInspectAllAsync(MetadataGatewayInspectAllCommand command, IActorRef replyTo)
    {
        var self = Self;
        _ = _metadataActor.Ask<MetadataRecord[]>(new MetadataInspectAll(), DefaultTimeout)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new InspectAllCompleted(task.Result, replyTo)
                    : new InspectAllErrored(task.Exception?.GetBaseException() ?? new InvalidOperationException("Metadata inspection failed."), replyTo),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }
}
