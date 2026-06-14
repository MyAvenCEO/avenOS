namespace Aven.SchemaRegistry.Contracts.Responses;

public sealed record SchemaValidationFailed(SchemaRef SchemaRef, string Json, IReadOnlyList<string> Errors);
