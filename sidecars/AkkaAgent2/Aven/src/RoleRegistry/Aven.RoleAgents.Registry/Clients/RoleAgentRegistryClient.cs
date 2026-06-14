using Akka.Actor;

namespace Aven.RoleAgents.Registry.Clients;

public sealed class RoleAgentRegistryClient : IRoleAgentRegistryClient
{
    private readonly IActorRef _actor;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    public RoleAgentRegistryClient(IActorRef actor) => _actor = actor;

    public void Register(RoleAgentProfile profile)
        => RegisterAsync(profile).GetAwaiter().GetResult();

    public Task RegisterAsync(RoleAgentProfile profile) =>
        _actor.Ask<object>(new UpsertRoleAgentProfileCommand(profile), DefaultTimeout);

    public IReadOnlyList<RoleAgentProfile> ListProfiles() =>
        ListProfilesAsync().GetAwaiter().GetResult();

    public Task<IReadOnlyList<RoleAgentProfile>> ListProfilesAsync() =>
        _actor.Ask<IReadOnlyList<RoleAgentProfile>>(new ListRoleAgentProfilesCommand(), DefaultTimeout);

    public bool TryGet(RoleAgentId agentId, out RoleAgentProfile profile)
    {
        var result = _actor.Ask<RoleAgentProfile?>(new GetRoleAgentProfileCommand(agentId), DefaultTimeout).GetAwaiter().GetResult();
        if (result is not null)
        {
            profile = result;
            return true;
        }

        profile = null!;
        return false;
    }
}
