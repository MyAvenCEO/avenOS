using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;

namespace Aven.Toolkit.Core.Serialization;

public sealed class CanonicalJsonSerializer
{
    public string Serialize<T>(T value)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, DefaultOptions));
        RejectDuplicateObjectProperties(document.RootElement);
        var builder = new StringBuilder();
        WriteCanonical(document.RootElement, builder);
        return builder.ToString();
    }

    public string Canonicalize(string json)
    {
        RejectDuplicateObjectProperties(json);
        using var document = JsonDocument.Parse(json);
        var builder = new StringBuilder();
        WriteCanonical(document.RootElement, builder);
        return builder.ToString();
    }

    public string Hash<T>(T value)
    {
        var canonicalJson = Serialize(value);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public string HashJson(string json)
    {
        var canonicalJson = Canonicalize(json);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static JsonSerializerOptions DefaultOptions { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        Converters = { new ReadOnlySetCanonicalJsonConverterFactory() }
    };

    private static void WriteCanonical(JsonElement element, StringBuilder builder)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                builder.Append('{');
                var properties = element.EnumerateObject().OrderBy(x => x.Name, StringComparer.Ordinal).ToArray();
                for (var i = 0; i < properties.Length; i++)
                {
                    if (i > 0)
                    {
                        builder.Append(',');
                    }

                    builder.Append(JsonSerializer.Serialize(properties[i].Name));
                    builder.Append(':');
                    WriteCanonical(properties[i].Value, builder);
                }

                builder.Append('}');
                break;

            case JsonValueKind.Array:
                builder.Append('[');
                var first = true;
                foreach (var item in element.EnumerateArray())
                {
                    if (!first)
                    {
                        builder.Append(',');
                    }

                    first = false;
                    WriteCanonical(item, builder);
                }

                builder.Append(']');
                break;

            case JsonValueKind.String:
                builder.Append(JsonSerializer.Serialize(element.GetString()));
                break;

            case JsonValueKind.Number:
                builder.Append(CanonicalizeNumber(element.GetRawText()));
                break;

            case JsonValueKind.True:
            case JsonValueKind.False:
            case JsonValueKind.Null:
                builder.Append(element.GetRawText());
                break;

            default:
                throw new NotSupportedException($"Unsupported JSON value kind: {element.ValueKind}");
        }
    }

    private static string CanonicalizeNumber(string raw)
    {
        if (decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var decimalValue))
        {
            if (decimalValue == 0m)
            {
                return "0";
            }

            return decimalValue.ToString("G29", CultureInfo.InvariantCulture);
        }

        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var doubleValue) && double.IsFinite(doubleValue))
        {
            return doubleValue.ToString("R", CultureInfo.InvariantCulture);
        }

        throw new JsonException($"JSON number cannot be canonicalized deterministically: {raw}");
    }

    private static void RejectDuplicateObjectProperties(string json)
    {
        var reader = new Utf8JsonReader(Encoding.UTF8.GetBytes(json), new JsonReaderOptions
        {
            CommentHandling = JsonCommentHandling.Disallow,
            AllowTrailingCommas = false
        });
        var objectPropertyNames = new Stack<HashSet<string>>();

        while (reader.Read())
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.StartObject:
                    objectPropertyNames.Push(new HashSet<string>(StringComparer.Ordinal));
                    break;
                case JsonTokenType.EndObject:
                    objectPropertyNames.Pop();
                    break;
                case JsonTokenType.PropertyName:
                    var propertyName = reader.GetString() ?? string.Empty;
                    if (!objectPropertyNames.Peek().Add(propertyName))
                    {
                        throw new JsonException($"Duplicate JSON object property rejected: {propertyName}");
                    }

                    break;
            }
        }
    }

    private static void RejectDuplicateObjectProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name))
                {
                    throw new JsonException($"Duplicate JSON object property rejected: {property.Name}");
                }

                RejectDuplicateObjectProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                RejectDuplicateObjectProperties(item);
            }
        }
    }

    private sealed class ReadOnlySetCanonicalJsonConverterFactory : JsonConverterFactory
    {
        public override bool CanConvert(Type typeToConvert)
            => typeToConvert.IsGenericType && typeToConvert.GetGenericTypeDefinition() == typeof(IReadOnlySet<>);

        public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options)
        {
            var elementType = typeToConvert.GetGenericArguments()[0];
            return (JsonConverter)Activator.CreateInstance(typeof(ReadOnlySetCanonicalJsonConverter<>).MakeGenericType(elementType))!;
        }
    }

    private sealed class ReadOnlySetCanonicalJsonConverter<T> : JsonConverter<IReadOnlySet<T>>
    {
        public override IReadOnlySet<T>? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var values = JsonSerializer.Deserialize<List<T>>(ref reader, options) ?? [];
            return values.ToHashSet();
        }

        public override void Write(Utf8JsonWriter writer, IReadOnlySet<T> value, JsonSerializerOptions options)
        {
            var ordered = value
                .Select(item => JsonSerializer.SerializeToElement(item, options))
                .Select(element =>
                {
                    var builder = new StringBuilder();
                    WriteCanonical(element, builder);
                    return builder.ToString();
                })
                .OrderBy(static canonical => canonical, StringComparer.Ordinal)
                .ToArray();

            writer.WriteStartArray();
            foreach (var canonicalJson in ordered)
            {
                using var document = JsonDocument.Parse(canonicalJson);
                document.RootElement.WriteTo(writer);
            }

            writer.WriteEndArray();
        }
    }
}