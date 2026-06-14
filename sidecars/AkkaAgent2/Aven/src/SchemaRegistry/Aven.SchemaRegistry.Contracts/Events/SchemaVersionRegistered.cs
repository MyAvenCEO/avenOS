namespace Aven.SchemaRegistry.Contracts.Events;

public sealed record SchemaVersionRegistered(
    SchemaRef SchemaRef,
    string JsonSchema,
    string Description,
    string SchemaHash,
    DateTimeOffset RegisteredAt) : IAvenEvent;
