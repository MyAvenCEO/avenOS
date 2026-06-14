namespace Aven.SchemaRegistry.Contracts.Models;

public sealed record RegisteredSchema(
    SchemaRef SchemaRef,
    string JsonSchema,
    string SchemaHash,
    string Description,
    DateTimeOffset RegisteredAt,
    string FamilyRef,
    int Version);
