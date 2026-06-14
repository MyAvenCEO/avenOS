namespace Aven.SchemaRegistry.Contracts.Responses;

public sealed record SchemaValidationSucceeded(SchemaRef SchemaRef, string Json);
