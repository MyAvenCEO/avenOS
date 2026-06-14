using Aven.Roles.Support;

namespace Aven.Api.Runtime;

internal static class RuntimeRoleCapabilitySpecs
{
    public static IReadOnlyList<RoleCapabilityGrantSpec> ForRole(string roleName) =>
        RoleCapabilityCatalog.ForRole(roleName)
            .Select(definition => new RoleCapabilityGrantSpec(
                definition.LocalName,
                ResourceAddresses.Gateway(definition.ResourceKind),
                definition.MessageType))
            .ToArray();
}
