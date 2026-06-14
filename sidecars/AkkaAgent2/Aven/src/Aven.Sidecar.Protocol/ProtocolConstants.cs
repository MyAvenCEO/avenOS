using System.Text.Json;
using System.Text.Json.Serialization;

namespace Aven.Sidecar.Protocol;

/// <summary>Top-level constants and shared JSON options for the stdio protocol.</summary>
public static class ProtocolConstants
{
    /// <summary>The only supported protocol version (spec §15).</summary>
    public const int Version = 1;

    /// <summary>
    /// Shared serializer options. Explicit <c>JsonPropertyName</c> attributes on the
    /// envelope keep wire names stable; nulls are omitted so absent slots do not appear.
    /// Enums serialize as camelCase strings to match the TS/Rust side.
    /// </summary>
    public static readonly JsonSerializerOptions Json = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}

/// <summary>The three envelope kinds (spec §4.1).</summary>
public static class ProtocolKind
{
    public const string Request = "request";
    public const string Response = "response";
    public const string Event = "event";
}
