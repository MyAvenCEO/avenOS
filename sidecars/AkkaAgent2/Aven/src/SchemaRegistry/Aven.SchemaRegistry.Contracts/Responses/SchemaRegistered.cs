namespace Aven.SchemaRegistry.Contracts.Responses;

public sealed record SchemaRegistered(SchemaRef SchemaRef, string JsonSchema, string Description, DateTimeOffset RegisteredAt);
