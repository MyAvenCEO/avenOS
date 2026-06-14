namespace Aven.Roles.Support;

public static class RoleCapabilityIds
{
    public static string ForRoleAgent(RoleAgentId roleAgentId, string localCapabilityName)
    {
        if (string.IsNullOrWhiteSpace(roleAgentId.Value))
        {
            throw new ArgumentException("Role agent id is required.", nameof(roleAgentId));
        }

        if (string.IsNullOrWhiteSpace(localCapabilityName))
        {
            throw new ArgumentException("Capability name is required.", nameof(localCapabilityName));
        }

        return $"{roleAgentId.Value}:{localCapabilityName}";
    }
}