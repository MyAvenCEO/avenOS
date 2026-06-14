using Akka.Actor;
using Aven.ActorKernel;
using Aven.Resources.Human.Persistence.HumanPrompts;

namespace Aven.Api.Persistence.HumanPrompts;

internal sealed class HumanPromptRegistryActor : AvenPersistentActor
{
    private readonly Dictionary<string, HumanPromptRegistration> _registrations = new(StringComparer.OrdinalIgnoreCase);

    public HumanPromptRegistryActor(string persistenceId)
    {
        PersistenceId = persistenceId;

        Command<HumanPromptRegistryUpsert>(command =>
        {
            var evt = new HumanPromptTracked(
                new PromptId(command.Registration.PromptId),
                new OperationKey(
                    new ActorAddress(command.Registration.CallerValue, command.Registration.CallerProtocol),
                    new RequestId(command.Registration.RequestId),
                    command.Registration.OperationType),
                new CorrelationId(command.Registration.CorrelationId),
                new ActorAddress(command.Registration.AdapterValue, command.Registration.AdapterProtocol),
                new ActorAddress(command.Registration.ReplyToValue, command.Registration.ReplyToProtocol),
                command.Registration.PromptText,
                command.Registration.ExpiresAt,
                string.IsNullOrWhiteSpace(command.Registration.CapabilityId) ? null : new CapabilityId(command.Registration.CapabilityId));
            var replyTo = Sender;
            PersistEvent(evt, MetadataFor<HumanPromptTracked>(
                new ActorAddress("human-prompt-registry", "local"),
                nameof(HumanPromptRegistryActor),
                evt.CorrelationId,
                evt,
                operationKey: evt.Key), tracked =>
            {
                var persisted = CreateRegistration(tracked);
                Apply(persisted);
                replyTo.Tell(persisted);
            });
        });

        Command<HumanPromptRegistryGet>(command => Sender.Tell(_registrations.TryGetValue(command.PromptId, out var registration) ? registration : null));
        Command<HumanPromptRegistryList>(_ => Sender.Tell(_registrations.Values.OrderBy(static x => x.PromptId, StringComparer.OrdinalIgnoreCase).ToArray()));

        RecoverEvent<HumanPromptTracked>(tracked => Apply(CreateRegistration(tracked)));
    }

    public override string PersistenceId { get; }

    private void Apply(HumanPromptRegistration registration) => _registrations[registration.PromptId] = registration;

    private static HumanPromptRegistration CreateRegistration(HumanPromptTracked tracked) =>
        new(
            tracked.PromptId.Value,
            tracked.Key.Caller.Value,
            tracked.Key.Caller.Protocol,
            tracked.Key.RequestId.Value,
            tracked.Key.OperationType,
            tracked.CorrelationId.Value,
            tracked.Adapter.Value,
            tracked.Adapter.Protocol,
            tracked.ReplyTo.Value,
            tracked.ReplyTo.Protocol,
            tracked.PromptText,
            tracked.ExpiresAt,
            tracked.CapabilityId?.Value);
}
