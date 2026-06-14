using System.Text.Json;
using System.Text.RegularExpressions;
using System.Globalization;

namespace Aven.Toolkit.Core.Schema;

public sealed class SimpleJsonSchemaValidator
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
            if (!MatchesType(typeElement, instance))
            {
                errors.Add($"{path}: expected type '{typeElement.GetRawText()}' but found '{instance.ValueKind}'.");
                return;
            }
        }

        if (schema.TryGetProperty("enum", out var enumElement) && enumElement.ValueKind == JsonValueKind.Array)
        {
            var instanceRaw = instance.GetRawText();
            var matches = enumElement.EnumerateArray().Any(candidate => string.Equals(candidate.GetRawText(), instanceRaw, StringComparison.Ordinal));
            if (!matches)
            {
                errors.Add($"{path}: value is not one of the allowed enum members.");
                return;
            }
        }

        if (schema.TryGetProperty("const", out var constElement))
        {
            if (!string.Equals(constElement.GetRawText(), instance.GetRawText(), StringComparison.Ordinal))
            {
                errors.Add($"{path}: value does not match required const value.");
                return;
            }
        }

        if (instance.ValueKind == JsonValueKind.String && schema.TryGetProperty("pattern", out var patternElement) && patternElement.ValueKind == JsonValueKind.String)
        {
            var pattern = patternElement.GetString();
            var value = instance.GetString() ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(pattern) && !Regex.IsMatch(value, pattern))
            {
                errors.Add($"{path}: string value does not match required pattern '{pattern}'.");
            }
        }

        if (instance.ValueKind == JsonValueKind.String && schema.TryGetProperty("minLength", out var minLengthElement) && minLengthElement.ValueKind == JsonValueKind.Number)
        {
            var value = instance.GetString() ?? string.Empty;
            if (value.Length < minLengthElement.GetInt32())
            {
                errors.Add($"{path}: string is shorter than the minimum length.");
            }
        }

        if (instance.ValueKind == JsonValueKind.String && schema.TryGetProperty("maxLength", out var maxLengthElement) && maxLengthElement.ValueKind == JsonValueKind.Number)
        {
            var value = instance.GetString() ?? string.Empty;
            if (value.Length > maxLengthElement.GetInt32())
            {
                errors.Add($"{path}: string is longer than the maximum length.");
            }
        }

        if (instance.ValueKind == JsonValueKind.String && schema.TryGetProperty("format", out var formatElement) && formatElement.ValueKind == JsonValueKind.String)
        {
            var format = formatElement.GetString();
            var value = instance.GetString() ?? string.Empty;
            if (!MatchesFormat(format, value))
            {
                errors.Add($"{path}: string does not match required format '{format}'.");
            }
        }

        if (instance.ValueKind == JsonValueKind.Number && schema.TryGetProperty("minimum", out var minimumElement) && minimumElement.ValueKind == JsonValueKind.Number)
        {
            if (instance.GetDecimal() < minimumElement.GetDecimal())
            {
                errors.Add($"{path}: number is less than the minimum value.");
            }
        }

        if (instance.ValueKind == JsonValueKind.Number && schema.TryGetProperty("maximum", out var maximumElement) && maximumElement.ValueKind == JsonValueKind.Number)
        {
            if (instance.GetDecimal() > maximumElement.GetDecimal())
            {
                errors.Add($"{path}: number exceeds the maximum value.");
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

                if (schema.TryGetProperty("additionalProperties", out var additionalPropertiesElement) &&
                    additionalPropertiesElement.ValueKind == JsonValueKind.False)
                {
                    var allowed = new HashSet<string>(propertiesElement.EnumerateObject().Select(static p => p.Name), StringComparer.Ordinal);
                    foreach (var property in instance.EnumerateObject())
                    {
                        if (!allowed.Contains(property.Name))
                        {
                            errors.Add($"{path}: additional property '{property.Name}' is not allowed.");
                        }
                    }
                }
            }
        }

        if (instance.ValueKind == JsonValueKind.Array)
        {
            if (schema.TryGetProperty("minItems", out var minItemsElement) && minItemsElement.ValueKind == JsonValueKind.Number &&
                instance.GetArrayLength() < minItemsElement.GetInt32())
            {
                errors.Add($"{path}: array has fewer than the minimum number of items.");
            }

            if (schema.TryGetProperty("maxItems", out var maxItemsElement) && maxItemsElement.ValueKind == JsonValueKind.Number &&
                instance.GetArrayLength() > maxItemsElement.GetInt32())
            {
                errors.Add($"{path}: array has more than the maximum number of items.");
            }

            if (schema.TryGetProperty("items", out var itemsElement))
            {
                var index = 0;
                foreach (var item in instance.EnumerateArray())
                {
                    ValidateElement($"{path}[{index}]", itemsElement, item, errors);
                    index++;
                }
            }
        }
    }

    private static bool MatchesType(JsonElement typeElement, JsonElement instance)
    {
        if (typeElement.ValueKind == JsonValueKind.Array)
        {
            return typeElement.EnumerateArray()
                .Where(static x => x.ValueKind == JsonValueKind.String)
                .Select(x => x.GetString())
                .Any(expectedType => MatchesSingleType(expectedType, instance));
        }

        if (typeElement.ValueKind == JsonValueKind.String)
        {
            return MatchesSingleType(typeElement.GetString(), instance);
        }

        return true;
    }

    private static bool MatchesSingleType(string? expectedType, JsonElement instance)
        => expectedType switch
        {
            "object" => instance.ValueKind == JsonValueKind.Object,
            "string" => instance.ValueKind == JsonValueKind.String,
            "number" => instance.ValueKind == JsonValueKind.Number,
            "integer" => instance.ValueKind == JsonValueKind.Number && instance.TryGetInt64(out _),
            "boolean" => instance.ValueKind is JsonValueKind.True or JsonValueKind.False,
            "array" => instance.ValueKind == JsonValueKind.Array,
            "null" => instance.ValueKind == JsonValueKind.Null,
            _ => true
        };

    private static bool MatchesFormat(string? format, string value)
        => format switch
        {
            null or "" => true,
            "date" => DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
            "date-time" => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _),
            "uri" => Uri.TryCreate(value, UriKind.Absolute, out _),
            _ => true
        };
}