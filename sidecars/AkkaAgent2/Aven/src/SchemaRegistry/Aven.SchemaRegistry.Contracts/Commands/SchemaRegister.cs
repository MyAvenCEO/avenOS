namespace Aven.SchemaRegistry.Contracts.Commands;

public sealed record SchemaRegister(SchemaRef SchemaRef, string JsonSchema, string Description);
