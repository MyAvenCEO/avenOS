namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmStructuredOutputSummary(SchemaRef SchemaRef, string SchemaHash, bool Strict);
