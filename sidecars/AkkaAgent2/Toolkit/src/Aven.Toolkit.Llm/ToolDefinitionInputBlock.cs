namespace Aven.Toolkit.Llm;

public sealed record ToolDefinitionInputBlock(string Name, string Description, string JsonSchema) : LlmInputBlock(LlmBlockKind.ToolDefinition);
