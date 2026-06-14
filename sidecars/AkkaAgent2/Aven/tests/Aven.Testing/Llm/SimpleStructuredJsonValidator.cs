using System.Text.Json;

namespace Aven.Resources.Llm;

internal sealed class SimpleStructuredJsonValidator
{
    public IReadOnlyList<string> Validate(string schemaJson, string instanceJson)
    {
        using var schemaDocument = JsonDocument.Parse(schemaJson);
        using var instanceDocument = JsonDocument.Parse(instanceJson);

        var errors = new List<string>();
        ValidateElement("$", schemaDocument.RootElement, instanceDocument.RootElement, errors);
        return errors;
    }

    private static void ValidateElement(string path, JsonElement schema, JsonElement instance, List<string> errors)
    {
        if (schema.TryGetProperty("type", out var typeElement))
        {
            var expectedType = typeElement.GetString();
            if (!MatchesType(expectedType, instance.ValueKind))
            {
                errors.Add($"{path}: expected type '{expectedType}' but found '{instance.ValueKind}'.");
                return;
            }
        }

        if (instance.ValueKind == JsonValueKind.Object)
        {
            var required = new HashSet<string>(StringComparer.Ordinal);
            if (schema.TryGetProperty("required", out var requiredElement) && requiredElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in requiredElement.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        required.Add(item.GetString()!);
                    }
                }
            }

            foreach (var propertyName in required)
            {
                if (!instance.TryGetProperty(propertyName, out _))
                {
                    errors.Add($"{path}: missing required property '{propertyName}'.");
                }
            }

            if (schema.TryGetProperty("properties", out var propertiesElement) && propertiesElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in propertiesElement.EnumerateObject())
                {
                    if (instance.TryGetProperty(property.Name, out var child))
                    {
                        ValidateElement($"{path}.{property.Name}", property.Value, child, errors);
                    }
                }
            }
        }
    }

    private static bool MatchesType(string? expectedType, JsonValueKind actual) => expectedType switch
    {
        "object" => actual == JsonValueKind.Object,
        "string" => actual == JsonValueKind.String,
        "number" => actual == JsonValueKind.Number,
        "integer" => actual == JsonValueKind.Number,
        "boolean" => actual is JsonValueKind.True or JsonValueKind.False,
        "array" => actual == JsonValueKind.Array,
        "null" => actual == JsonValueKind.Null,
        _ => true
    };
}