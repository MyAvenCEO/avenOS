using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Aven.Sidecar.Protocol;

/// <summary>
/// Structured error payload (STDIO_RPC_SPEC.md §12.1). Machine code + human message,
/// a retryable hint, and optional data. The machine <see cref="Code"/> must survive
/// the .NET → Rust → TS hop, so it is never flattened to opaque text.
/// </summary>
public sealed class ProtocolError
{
    public ProtocolError()
    {
    }

    public ProtocolError(string code, string message, bool retryable = false, JsonNode? data = null)
    {
        Code = code;
        Message = message;
        Retryable = retryable;
        Data = data;
    }

    [JsonPropertyName("code")]
    public string Code { get; set; } = ProtocolErrorCodes.InternalError;

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("retryable")]
    public bool Retryable { get; set; }

    [JsonPropertyName("data")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonNode? Data { get; set; }
}

/// <summary>Machine-readable error codes from the spec (§12.2). Stable strings.</summary>
public static class ProtocolErrorCodes
{
    // Caller / validation
    public const string InvalidRequest = "invalid_request";
    public const string UnknownMethod = "unknown_method";
    public const string InvalidParams = "invalid_params";
    public const string NotFound = "not_found";
    public const string Conflict = "conflict";

    // Runtime / state
    public const string AgentNotFound = "agent_not_found";
    public const string HumanPromptNotFound = "human_prompt_not_found";
    public const string RuntimeNotReady = "runtime_not_ready";
    public const string ArtifactNotFound = "artifact_not_found";

    // Infrastructure
    public const string Timeout = "timeout";
    public const string IoError = "io_error";
    public const string InternalError = "internal_error";
    public const string StartupFailed = "startup_failed";
}
