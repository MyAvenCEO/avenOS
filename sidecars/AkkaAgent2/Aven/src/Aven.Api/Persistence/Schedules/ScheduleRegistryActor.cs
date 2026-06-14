using Akka.Actor;
using Aven.ActorKernel;

namespace Aven.Api.Persistence.Schedules;

internal sealed class ScheduleRegistryActor : AvenPersistentActor
{
    private readonly Dictionary<string, ScheduledRoleWorkRegistration> _registrations = new(StringComparer.OrdinalIgnoreCase);

    public ScheduleRegistryActor(string persistenceId)
    {
        PersistenceId = persistenceId;

        Command<ScheduleRegistryUpsert>(command =>
        {
            var recurrence = TimeSpan.TryParse(command.Registration.Recurrence, out var parsedRecurrence)
                ? parsedRecurrence
                : (TimeSpan?)null;
            var evt = new ScheduledRoleWorkRegistered(
                command.Registration.ScheduleId,
                new RoleAgentId(command.Registration.TargetAgentValue),
                new OperationKey(
                    ResourceAddresses.Gateway(ResourceKinds.Schedule),
                    new RequestId(command.Registration.RequestId),
                    command.Registration.TargetOperationType),
                command.Registration.CorrelationId,
                command.Registration.Summary,
                command.Registration.DueAt,
                recurrence,
                command.Registration.CommandPayloadJson,
                PersistedCommandPayload.ComputeHash(command.Registration.CommandPayloadJson),
                System.Text.Encoding.UTF8.GetByteCount(command.Registration.CommandPayloadJson));
            var replyTo = Sender;
            PersistEvent(evt, MetadataFor<ScheduledRoleWorkRegistered>(
                new ActorAddress("schedule-registry", "local"),
                nameof(ScheduleRegistryActor),
                evt.CorrelationId,
                evt,
                operationKey: evt.OperationKey,
                occurredAt: evt.DueAt), registration =>
            {
                var persisted = CreateScheduledRoleWorkRegistration(registration);
                Apply(persisted);
                replyTo.Tell(persisted);
            });
        });

        Command<ScheduleRegistryGet>(command => Sender.Tell(_registrations.TryGetValue(command.ScheduleId, out var registration) ? registration : null));

        RecoverEvent<ScheduledRoleWorkRegistered>(registration => Apply(CreateScheduledRoleWorkRegistration(registration)));
    }

    public override string PersistenceId { get; }

    private void Apply(ScheduledRoleWorkRegistration registration) => _registrations[registration.ScheduleId] = registration;

    private static ScheduledRoleWorkRegistration CreateScheduledRoleWorkRegistration(ScheduledRoleWorkRegistered registration) =>
        new(
            registration.ScheduleId,
            registration.OperationKey.RequestId.Value,
            registration.RoleAgentId.Value,
            "local",
            registration.OperationKey.OperationType,
            registration.PayloadJson,
            registration.CorrelationId,
            registration.DueAt,
            registration.RoleName,
            MissedRunPolicy.RunImmediately.ToString(),
            registration.Recurrence?.ToString());

}
