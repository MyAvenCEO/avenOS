namespace Aven.Sidecar.Protocol;

/// <summary>Thrown when an envelope violates the structural rules in spec §4.2.</summary>
public sealed class ProtocolValidationException(string message) : Exception(message);

/// <summary>
/// Strict envelope validation (milestone plan M1, step 2; STDIO_RPC_SPEC.md §4.2):
/// <list type="bullet">
///   <item><c>v</c> must be 1.</item>
///   <item><c>kind</c> required.</item>
///   <item><c>id</c> required for request/response.</item>
///   <item><c>method</c> required for request.</item>
///   <item><c>result</c> XOR <c>error</c> required for response.</item>
///   <item><c>event</c> required for event.</item>
/// </list>
/// </summary>
public static class ProtocolValidation
{
    /// <summary>Validate, returning <c>false</c> and a reason instead of throwing.</summary>
    public static bool TryValidate(ProtocolEnvelope? envelope, out string? error)
    {
        if (envelope is null)
        {
            error = "Envelope is null.";
            return false;
        }

        if (envelope.V != ProtocolConstants.Version)
        {
            error = $"Unsupported protocol version 'v={envelope.V}'; expected {ProtocolConstants.Version}.";
            return false;
        }

        switch (envelope.Kind)
        {
            case ProtocolKind.Request:
                if (string.IsNullOrEmpty(envelope.Id))
                {
                    error = "Request envelope requires 'id'.";
                    return false;
                }

                if (string.IsNullOrEmpty(envelope.Method))
                {
                    error = "Request envelope requires 'method'.";
                    return false;
                }

                break;

            case ProtocolKind.Response:
                if (string.IsNullOrEmpty(envelope.Id))
                {
                    error = "Response envelope requires 'id'.";
                    return false;
                }

                var hasResult = envelope.Result is not null;
                var hasError = envelope.Error is not null;
                if (hasResult == hasError)
                {
                    error = "Response envelope requires exactly one of 'result' or 'error'.";
                    return false;
                }

                break;

            case ProtocolKind.Event:
                if (envelope.Event is null)
                {
                    error = "Event envelope requires 'event'.";
                    return false;
                }

                break;

            case null:
            case "":
                error = "Envelope requires 'kind'.";
                return false;

            default:
                error = $"Unknown envelope kind '{envelope.Kind}'.";
                return false;
        }

        error = null;
        return true;
    }

    /// <summary>Validate or throw <see cref="ProtocolValidationException"/>.</summary>
    public static void Validate(ProtocolEnvelope? envelope)
    {
        if (!TryValidate(envelope, out var error))
        {
            throw new ProtocolValidationException(error!);
        }
    }
}
