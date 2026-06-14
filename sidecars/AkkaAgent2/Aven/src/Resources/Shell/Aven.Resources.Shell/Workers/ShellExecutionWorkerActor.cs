
namespace Aven.Resources.Shell.Workers;

internal sealed class ShellExecutionWorkerActor : ReceiveActor
{
    private sealed record ForwardAndStop(object Message);

    public sealed record ExecuteStarted(ResourceGatewayRail<ShellExecuteOperationPayload>.Started Started);
    public sealed record ExecuteRecovered(ResourceGatewayRail<ShellExecuteOperationPayload>.Recovered Recovered);
    public sealed record StartedCompleted(ResourceGatewayRail<ShellExecuteOperationPayload>.Started Started, ShellExecuteOperationResult Result);
    public sealed record StartedErrored(ResourceGatewayRail<ShellExecuteOperationPayload>.Started Started, Exception Exception);
    public sealed record RecoveredCompleted(ResourceGatewayRail<ShellExecuteOperationPayload>.Recovered Recovered, ShellExecuteOperationResult Result);
    public sealed record RecoveredErrored(ResourceGatewayRail<ShellExecuteOperationPayload>.Recovered Recovered, Exception Exception);

    private readonly ShellCommandExecutor _executor;
    private readonly IActorRef _gateway;

    public ShellExecutionWorkerActor(ShellGatewayOptions options, IActorRef gateway)
    {
        _executor = new ShellCommandExecutor(options);
        _gateway = gateway;

        Receive<ForwardAndStop>(message =>
        {
            _gateway.Tell(message.Message, Self);
            Context.Stop(Self);
        });

        Receive<ExecuteStarted>(message => ExecuteStartedAsync(message.Started));
        Receive<ExecuteRecovered>(message => ExecuteRecoveredAsync(message.Recovered));
    }

    private void ExecuteStartedAsync(ResourceGatewayRail<ShellExecuteOperationPayload>.Started started)
    {
        var self = Self;
        _ = _executor.ExecuteAsync(started.Payload)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StartedCompleted(started, task.Result)
                    : new StartedErrored(started, task.Exception?.GetBaseException() ?? new InvalidOperationException("Shell worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteRecoveredAsync(ResourceGatewayRail<ShellExecuteOperationPayload>.Recovered recovered)
    {
        var self = Self;
        _ = _executor.ExecuteAsync(recovered.Payload)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RecoveredCompleted(recovered, task.Result)
                    : new RecoveredErrored(recovered, task.Exception?.GetBaseException() ?? new InvalidOperationException("Shell worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }
}
