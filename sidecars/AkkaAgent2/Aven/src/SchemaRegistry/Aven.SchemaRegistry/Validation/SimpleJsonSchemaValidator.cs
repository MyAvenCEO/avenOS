namespace Aven.SchemaRegistry.Validation;

internal sealed class SimpleJsonSchemaValidator
{
    private readonly Aven.Toolkit.Core.Schema.SimpleJsonSchemaValidator _inner = new();

    public IReadOnlyList<string> Validate(string schemaJson, string instanceJson) =>
        _inner.Validate(schemaJson, instanceJson);
}