using System.Security.Cryptography;
using System.Text;

namespace Aven.Contracts.Payloads;

public sealed record PersistedCommandPayload(
    string Json,
    string Hash,
    int SizeBytes,
    string? ArtifactRef = null)
{
    public const int MaxInlineJsonBytes = 64 * 1024;

    public static PersistedCommandPayload FromInlineJson(string json)
    {
        var sizeBytes = Encoding.UTF8.GetByteCount(json);
        if (sizeBytes > MaxInlineJsonBytes)
        {
            throw new InvalidOperationException($"Inline command payload is {sizeBytes} bytes and exceeds the {MaxInlineJsonBytes} byte limit. Store it as an artifact-backed command payload before persistence.");
        }

        return new PersistedCommandPayload(json, ComputeHash(json), sizeBytes);
    }

    public static string ComputeHash(string json) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
}
