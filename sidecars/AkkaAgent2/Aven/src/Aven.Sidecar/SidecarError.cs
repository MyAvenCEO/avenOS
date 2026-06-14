using System.Text.Json.Nodes;
using Aven.Sidecar.Protocol;

namespace Aven.Sidecar;

/// <summary>
/// A dispatch failure that maps to a structured protocol error response. Carries the
/// machine code, message, retryable hint, and optional data so the .NET → Rust → TS
/// hop never flattens to opaque text (STDIO_RPC_SPEC.md §12.3).
/// </summary>
public sealed class SidecarError(string code, string message, bool retryable = false, JsonNode? data = null)
    : Exception(message)
{
    public string Code { get; } = code;

    public bool Retryable { get; } = retryable;

    public JsonNode? ErrorData { get; } = data;

    public ProtocolError ToProtocolError() => new(Code, Message, Retryable, ErrorData);

    public static SidecarError UnknownMethod(string method) =>
        new(ProtocolErrorCodes.UnknownMethod, $"Unknown method '{method}'.");

    public static SidecarError InvalidParams(string message) =>
        new(ProtocolErrorCodes.InvalidParams, message);

    public static SidecarError NotFound(string message) =>
        new(ProtocolErrorCodes.NotFound, message);

    public static SidecarError RuntimeNotReady(string message) =>
        new(ProtocolErrorCodes.RuntimeNotReady, message, retryable: true);
}
