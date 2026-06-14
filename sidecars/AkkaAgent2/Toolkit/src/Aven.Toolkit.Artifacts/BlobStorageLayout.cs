namespace Aven.Toolkit.Artifacts;

public static class BlobStorageLayout
{
    public const string Algorithm = "sha256";

    public static string GetStorageRef(BlobRef blob)
    {
        Validate(blob);
        return $"{Algorithm}/{blob.Hash[..2]}/{blob.Hash[2..4]}/{blob.Hash}";
    }

    public static string GetBlobPath(string rootPath, BlobRef blob) =>
        Path.Combine(rootPath, Algorithm, blob.Hash[..2], blob.Hash[2..4], blob.Hash);

    public static void Validate(BlobRef blob)
    {
        if (!string.Equals(blob.Algorithm, Algorithm, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Unsupported blob algorithm '{blob.Algorithm}'. Only '{Algorithm}' is supported.");
        }

        if (string.IsNullOrWhiteSpace(blob.Hash)
            || blob.Hash.Length != 64
            || !blob.Hash.All(static ch => char.IsAsciiHexDigit(ch)))
        {
            throw new InvalidOperationException("Blob hash must be a 64-character lowercase hexadecimal SHA-256 value.");
        }

        if (blob.SizeBytes < 0)
        {
            throw new InvalidOperationException("Blob size must be non-negative.");
        }
    }
}