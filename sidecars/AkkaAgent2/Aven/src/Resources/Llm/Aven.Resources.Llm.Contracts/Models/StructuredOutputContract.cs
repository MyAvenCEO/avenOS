namespace Aven.Resources.Llm.Contracts.Models;

public sealed record StructuredOutputContract(SchemaRef SchemaRef, string JsonSchema, bool Strict);
