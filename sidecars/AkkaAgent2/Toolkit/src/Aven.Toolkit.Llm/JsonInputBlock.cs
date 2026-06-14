namespace Aven.Toolkit.Llm;

public sealed record JsonInputBlock(string Json, string Role = "user") : LlmInputBlock(LlmBlockKind.Json);
