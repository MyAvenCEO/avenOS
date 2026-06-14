using Akka.Actor;
using Aven.Resources.Human.Contracts;
using Aven.Resources.Human.Gateways;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Human.Workers;

using HumanStarted = ResourceGatewayRail<HumanPromptOperationPayload>.Started;
using HumanRecovered = ResourceGatewayRail<HumanPromptOperationPayload>.Recovered;

internal sealed class HumanPromptRegistrationWorkerActor : ReceiveActor
{
    private sealed record ForwardAndStop(object Message);

    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    public sealed record ExecuteStarted(HumanStarted Started);
    public sealed record ExecuteRecovered(HumanRecovered Recovered);
    public sealed record StartedCompleted(HumanStarted Started);
    public sealed record StartedErrored(HumanStarted Started, Exception Exception);
    public sealed record RecoveredCompleted(HumanRecovered Recovered);
    public sealed record RecoveredErrored(HumanRecovered Recovered, Exception Exception);

    private readonly Func<HumanPromptRegistration, IActorRef> _promptFactory;
    private readonly IActorRef _registryActor;
    private readonly ActorAddress _humanGatewayAddress;
    private readonly IActorRef _gateway;

    public HumanPromptRegistrationWorkerActor(
        Func<HumanPromptRegistration, IActorRef> promptFactory,
        IActorRef registryActor,
        ActorAddress humanGatewayAddress,
        IActorRef gateway)
    {
        _promptFactory = promptFactory;
        _registryActor = registryActor;
        _humanGatewayAddress = humanGatewayAddress;
        _gateway = gateway;

        Receive<ForwardAndStop>(message =>
        {
            _gateway.Tell(message.Message, Self);
            Context.Stop(Self);
        });

        Receive<ExecuteStarted>(message => ExecuteStartedAsync(message.Started));
        Receive<ExecuteRecovered>(message => ExecuteRecoveredAsync(message.Recovered));
    }

    private void ExecuteStartedAsync(HumanStarted started)
    {
        var self = Self;
        _ = ExecuteStartedInternalAsync(started)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StartedCompleted(started)
                    : new StartedErrored(started, task.Exception?.GetBaseException() ?? new InvalidOperationException("Human prompt registration failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private void ExecuteRecoveredAsync(HumanRecovered recovered)
    {
        var self = Self;
        _ = ExecuteRecoveredInternalAsync(recovered)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RecoveredCompleted(recovered)
                    : new RecoveredErrored(recovered, task.Exception?.GetBaseException() ?? new InvalidOperationException("Recovered human prompt registration failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(new ForwardAndStop(task.Result), ActorRefs.NoSender), TaskScheduler.Default);
    }

    private Task ExecuteStartedInternalAsync(HumanStarted started) => EnsureRegisteredAsync(
        started.Key,
        started.Offer.Envelope.CorrelationId,
        started.Offer.Envelope.ReplyTo,
        started.Payload,
        started.InboxRecord.ResolvedCapabilityId);

    private Task ExecuteRecoveredInternalAsync(HumanRecovered recovered) => EnsureRegisteredAsync(
        recovered.Key,
        new CorrelationId(recovered.InboxRecord.CorrelationId),
        new ActorAddress(recovered.InboxRecord.ReplyToValue, recovered.InboxRecord.ReplyToProtocol),
        recovered.Payload,
        recovered.InboxRecord.ResolvedCapabilityId);

    private async Task EnsureRegisteredAsync(
        OperationKey key,
        CorrelationId correlationId,
        ActorAddress replyTo,
        HumanPromptOperationPayload payload,
        string? resolvedCapabilityId)
    {
        var promptId = HumanPromptIdentity.FromOperationKey(key);
        var registration = new HumanPromptRegistration(
            promptId.Value,
            key.Caller.Value,
            key.Caller.Protocol,
            key.RequestId.Value,
            key.OperationType,
            correlationId.Value,
            _humanGatewayAddress.Value,
            _humanGatewayAddress.Protocol,
            replyTo.Value,
            replyTo.Protocol,
            payload.PromptText,
            payload.ExpiresAt,
            resolvedCapabilityId);

        var promptActor = _promptFactory(registration);
        _ = await promptActor.Ask<HumanPromptState>(new HumanPromptEnsureRegistered(), DefaultTimeout);
        _ = await _registryActor.Ask<HumanPromptRegistration>(new HumanPromptRegistryUpsert(registration), DefaultTimeout);
    }
}
