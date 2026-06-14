namespace Aven.Roles.Support;

public sealed record RoleCapabilityDefinition(
    string RoleName,
    string LocalName,
    string ResourceKind,
    string MessageType);

public static class RoleCapabilityCatalog
{
    private static readonly IReadOnlyList<RoleCapabilityDefinition> Definitions =
    [
        new("accountant", "llm-extract", ResourceKinds.Llm, ResourceOperationTypes.LlmGenerate),
        new("accountant", "invoice-metadata", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("accountant", "statement-metadata", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("accountant", "transaction-metadata", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("accountant", "payment-match-metadata", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("accountant", "metadata-query", ResourceKinds.Metadata, ResourceOperationTypes.MetadataQuery),
        new("accountant", "human-review", ResourceKinds.Human, ResourceOperationTypes.HumanApprove),

        new("contract_watcher", "llm-contract", ResourceKinds.Llm, ResourceOperationTypes.LlmGenerate),
        new("contract_watcher", "contract-summary", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("contract_watcher", "contract-renewal", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("contract_watcher", "contract-reminder-fired", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("contract_watcher", "contract-reminder", ResourceKinds.Schedule, ResourceOperationTypes.ScheduleCreate),

        new("research_watch", "llm-research", ResourceKinds.Llm, ResourceOperationTypes.LlmGenerate),
        new("research_watch", "research-metadata", ResourceKinds.Metadata, ResourceOperationTypes.MetadataCreate),
        new("research_watch", "research-schedule", ResourceKinds.Schedule, ResourceOperationTypes.ScheduleCreate)
    ];

    private static readonly IReadOnlyDictionary<string, IReadOnlyList<RoleCapabilityDefinition>> DefinitionsByRole =
        Definitions
            .GroupBy(static definition => definition.RoleName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                static group => group.Key,
                static group => (IReadOnlyList<RoleCapabilityDefinition>)group.ToArray(),
                StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyList<RoleCapabilityDefinition> All => Definitions;

    public static IReadOnlyList<RoleCapabilityDefinition> ForRole(string roleName) =>
        DefinitionsByRole.TryGetValue(roleName, out var definitions)
            ? definitions
            : Array.Empty<RoleCapabilityDefinition>();
}
