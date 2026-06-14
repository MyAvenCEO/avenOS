namespace Aven.RoleAgents.Registry.Clients;

public sealed class InMemoryRoleAgentRegistryClient : IRoleAgentRegistryClient
{
    private readonly Dictionary<RoleAgentId, RoleAgentProfile> _profiles = new();

    public void Register(RoleAgentProfile profile) =>
        _profiles[profile.RoleAgentId] = profile;

    public Task RegisterAsync(RoleAgentProfile profile)
    {
        Register(profile);
        return Task.CompletedTask;
    }

    public IReadOnlyList<RoleAgentProfile> ListProfiles() =>
        _profiles.Values.OrderBy(static x => x.RoleName, StringComparer.Ordinal).ToArray();

    public Task<IReadOnlyList<RoleAgentProfile>> ListProfilesAsync() =>
        Task.FromResult(ListProfiles());

    public bool TryGet(RoleAgentId agentId, out RoleAgentProfile profile) =>
        _profiles.TryGetValue(agentId, out profile!);
}