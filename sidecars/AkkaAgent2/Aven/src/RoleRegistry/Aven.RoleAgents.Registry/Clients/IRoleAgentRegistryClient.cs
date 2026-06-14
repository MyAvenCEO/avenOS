namespace Aven.RoleAgents.Registry.Clients;

public interface IRoleAgentRegistryClient
{
    void Register(RoleAgentProfile profile);
    Task RegisterAsync(RoleAgentProfile profile);
    IReadOnlyList<RoleAgentProfile> ListProfiles();
    Task<IReadOnlyList<RoleAgentProfile>> ListProfilesAsync();
    bool TryGet(RoleAgentId agentId, out RoleAgentProfile profile);
}