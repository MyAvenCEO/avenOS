using Akka.Actor;
using Aven.Scheduling.Gateways;
using Aven.Resources.Runtime.Gateways;
using Aven.Scheduling.Contracts;

namespace Aven.Scheduling.Workers;

using ScheduleStarted = ResourceGatewayRail<ScheduledWorkOperationPayload>.Started;
using ScheduleRecovered = ResourceGatewayRail<ScheduledWorkOperationPayload>.Recovered;

internal sealed class ScheduleCreateWorkerActor : ReceiveActor
{
    public sealed record ExecuteStarted(ScheduleStarted Started);
    public sealed record ExecuteRecovered(ScheduleRecovered Recovered);
    public sealed record StartedCompleted(ScheduleStarted Started);
    public sealed record StartedErrored(ScheduleStarted Started, Exception Exception);
    public sealed record RecoveredCompleted(ScheduleRecovered Recovered);
    public sealed record RecoveredErrored(ScheduleRecovered Recovered, Exception Exception);

    private readonly Func<object, IActorRef> _scheduleFactory;
    private readonly IActorRef _gateway;

    public ScheduleCreateWorkerActor(Func<object, IActorRef> scheduleFactory, IActorRef gateway)
    {
        _scheduleFactory = scheduleFactory;
        _gateway = gateway;

        Receive<ExecuteStarted>(message => HandleStarted(message.Started));
        Receive<ExecuteRecovered>(message => HandleRecovered(message.Recovered));
    }

    private void HandleStarted(ScheduleStarted started)
    {
        try
        {
            _ = _scheduleFactory(started.Payload);
            _gateway.Tell(new StartedCompleted(started), Self);
        }
        catch (Exception ex)
        {
            _gateway.Tell(new StartedErrored(started, ex), Self);
        }
        finally
        {
            Context.Stop(Self);
        }
    }

    private void HandleRecovered(ScheduleRecovered recovered)
    {
        try
        {
            _ = _scheduleFactory(recovered.Payload);
            _gateway.Tell(new RecoveredCompleted(recovered), Self);
        }
        catch (Exception ex)
        {
            _gateway.Tell(new RecoveredErrored(recovered, ex), Self);
        }
        finally
        {
            Context.Stop(Self);
        }
    }
}
