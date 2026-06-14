namespace Aven.SchemaRegistry.Contracts.Commands;

public sealed record SchemaValidate(SchemaRef SchemaRef, string Json);
