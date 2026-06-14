using Akka.Actor;
using Aven.Resources.Artifacts.Gateways;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Artifacts.Workers;

internal sealed class ArtifactReadWorkerActor : ReceiveActor
{
    private sealed record ForwardAndStop(object Message);

    public sealed record ExecuteRead(ArtifactGatewayReadCommand Command, IActorRef ReplyTo);
    public sealed record ExecuteQuery(ArtifactGatewayQueryCommand Command, IActorRef ReplyTo);
    public sealed record ReadCompleted(ArtifactGatewayReadCommand Command, ArtifactDescriptor? Artifact, IActorRef ReplyTo);
    public sealed record ReadErrored(Exception Exception, IActorRef ReplyTo);
    public sealed record QueryCompleted(IReadOnlyList<ArtifactDescriptor> Artifacts, IActorRef ReplyTo);
    public sealed record QueryErrored(Exception Exception, IActorRef ReplyTo);

    private readonly IArtifactStore _artifactStore;
    private readonly IActorRef _gateway;

    public ArtifactReadWorkerActor(IArtifactStore artifactStore, IActorRef gateway)
    {
        _artifactStore = artifactStore;
        _gateway = gateway;

        Receive<ForwardAndStop>(message =>
        {
            _gateway.Tell(message.Message, Self);
            Context.Stop(Self);
        });

        Receive<ExecuteRead>(message => ExecuteReadAsync(message.Command, message.ReplyTo));
        Receive<ExecuteQuery>(message => ExecuteQueryAsync(message.Command, message.ReplyTo));
    }

    private void ExecuteReadAsync(ArtifactGatewayReadCommand command, IActorRef replyTo)
    {
        var self = Self;
        _ = _artifactStore.GetArtifactAsync(command.ArtifactId, CancellationToken.None)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new ReadCompleted(command, task.Result, replyTo)
                    : new ReadErrored(task.Exception?.GetBaseException() ?? new InvalidOperationException("Artifact read failed."), replyTo),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteQueryAsync(ArtifactGatewayQueryCommand command, IActorRef replyTo)
    {
        var self = Self;
        _ = _artifactStore.QueryArtifactsAsync(new ArtifactQuery(command.FilenameContains, command.MimeType, command.SourceKind, command.Limit), CancellationToken.None)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new QueryCompleted(task.Result, replyTo)
                    : new QueryErrored(task.Exception?.GetBaseException() ?? new InvalidOperationException("Artifact query failed."), replyTo),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }
}
