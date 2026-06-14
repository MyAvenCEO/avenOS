namespace Aven.Toolkit.Llm;

public sealed record TextInputBlock(string Text, string Role = "user") : LlmInputBlock(LlmBlockKind.Text);
