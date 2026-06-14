using Akka.Actor;
using Aven.ActorKernel;

namespace Aven.RoleAgents.Registry.Actors;

public sealed class RoleAgentRegistryActor : AvenPersistentActor
{
    private readonly Dictionary<RoleAgentId, RoleAgentProfile> _profiles = new();

    public RoleAgentRegistryActor(string persistenceId)
    {
        PersistenceId = persistenceId;

        Command<UpsertRoleAgentProfileCommand>(command =>
        {
            var replyTo = Sender;
            var evt = RoleAgentProfileUpserted.FromProfile(command.Profile);
            PersistEvent(evt, MetadataFor<RoleAgentProfileUpserted>(
                new ActorAddress("role-agent-registry", "local"),
                nameof(RoleAgentRegistryActor),
                new CorrelationId($"corr-{command.Profile.RoleAgentId.Value}"),
                command.Profile), e =>
            {
                Apply(e);
                replyTo.Tell(e.ToProfile());
            });
        });

        Command<GetRoleAgentProfileCommand>(command =>
        {
            Sender.Tell(_profiles.TryGetValue(command.RoleAgentId, out var profile) ? profile : null);
        });

        Command<ListRoleAgentProfilesCommand>(_ =>
        {
            Sender.Tell(ListProfiles());
        });

        RecoverEvent<RoleAgentProfileUpserted>(Apply);
    }

    public override string PersistenceId { get; }

    private void Apply(RoleAgentProfileUpserted upserted)
    {
        var profile = upserted.ToProfile();
        _profiles[profile.RoleAgentId] = profile;
    }

    private IReadOnlyList<RoleAgentProfile> ListProfiles() =>
        _profiles.Values.OrderBy(static x => x.RoleName, StringComparer.Ordinal).ToArray();
}
