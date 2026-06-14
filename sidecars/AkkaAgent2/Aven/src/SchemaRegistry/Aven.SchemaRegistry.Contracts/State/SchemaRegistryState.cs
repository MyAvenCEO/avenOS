namespace Aven.SchemaRegistry.Contracts.State;

public sealed record SchemaRegistryState(
    IReadOnlyDictionary<string, RegisteredSchema> Schemas,
    IReadOnlyDictionary<string, IReadOnlyList<string>> FamilyVersions)
{
    public static SchemaRegistryState Empty { get; } = new SchemaRegistryState(
        new Dictionary<string, RegisteredSchema>(StringComparer.Ordinal),
        new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal));
}
