namespace Aven.Toolkit.Llm;

public sealed record ToolResultInputBlock(string ToolName, string ResultJson) : LlmInputBlock(LlmBlockKind.ToolResult);
