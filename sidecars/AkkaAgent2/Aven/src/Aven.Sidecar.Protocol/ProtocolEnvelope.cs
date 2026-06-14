using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Aven.Sidecar.Protocol;

/// <summary>
/// The single generic stdio RPC envelope (see STDIO_RPC_SPEC.md §4.2).
///
/// Exactly three message kinds flow over the wire: <c>request</c>, <c>response</c>,
/// and <c>event</c>. The flexible payload slots (<see cref="Params"/>,
/// <see cref="Result"/>, <see cref="Event"/>, <see cref="Meta"/>) are kept as raw
/// <see cref="JsonNode"/> so the protocol layer never needs to know domain shapes;
/// the dispatcher binds them to typed DTOs.
/// </summary>
public sealed class ProtocolEnvelope
{
    /// <summary>Protocol version. Always <c>1</c> for this contract (spec §15).</summary>
    [JsonPropertyName("v")]
    public int V { get; set; } = ProtocolConstants.Version;

    /// <summary>One of <see cref="ProtocolKind"/>: request | response | event.</summary>
    [JsonPropertyName("kind")]
    public string? Kind { get; set; }

    /// <summary>Correlation id. Required on request and response.</summary>
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Id { get; set; }

    /// <summary>Dotted method name. Required on request; optional name tag on event.</summary>
    [JsonPropertyName("method")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Method { get; set; }

    /// <summary>Request parameters. Only valid on request.</summary>
    [JsonPropertyName("params")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonNode? Params { get; set; }

    /// <summary>Success payload. Mutually exclusive with <see cref="Error"/> on a response.</summary>
    [JsonPropertyName("result")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonNode? Result { get; set; }

    /// <summary>Structured failure. Mutually exclusive with <see cref="Result"/> on a response.</summary>
    [JsonPropertyName("error")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ProtocolError? Error { get; set; }

    /// <summary>Event payload. Required on event.</summary>
    [JsonPropertyName("event")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonNode? Event { get; set; }

    /// <summary>Free-form transport metadata (caller, window, timestamps, correlation).</summary>
    [JsonPropertyName("meta")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonNode? Meta { get; set; }

    /// <summary>Build a request envelope.</summary>
    public static ProtocolEnvelope Request(string id, string method, JsonNode? @params = null, JsonNode? meta = null) =>
        new() { Kind = ProtocolKind.Request, Id = id, Method = method, Params = @params, Meta = meta };

    /// <summary>Build a successful response envelope.</summary>
    public static ProtocolEnvelope ResponseResult(string id, JsonNode? result, JsonNode? meta = null) =>
        new() { Kind = ProtocolKind.Response, Id = id, Result = result ?? new JsonObject(), Meta = meta };

    /// <summary>Build a failed response envelope.</summary>
    public static ProtocolEnvelope ResponseError(string id, ProtocolError error, JsonNode? meta = null) =>
        new() { Kind = ProtocolKind.Response, Id = id, Error = error, Meta = meta };

    /// <summary>Build a server-originated event envelope.</summary>
    public static ProtocolEnvelope EventMessage(string method, JsonNode? @event, JsonNode? meta = null) =>
        new() { Kind = ProtocolKind.Event, Method = method, Event = @event ?? new JsonObject(), Meta = meta };
}
