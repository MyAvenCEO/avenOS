namespace Aven.SchemaRegistry.Contracts.Responses;

public sealed record SchemaFamilyVersionsListed(string FamilyRef, IReadOnlyList<RegisteredSchema> Schemas);
