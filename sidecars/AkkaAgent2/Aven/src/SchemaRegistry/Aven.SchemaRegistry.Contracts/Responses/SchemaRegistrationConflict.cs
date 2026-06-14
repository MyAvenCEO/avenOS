namespace Aven.SchemaRegistry.Contracts.Responses;

public sealed record SchemaRegistrationConflict(SchemaRef SchemaRef, string ExistingSchemaHash, string IncomingSchemaHash);
