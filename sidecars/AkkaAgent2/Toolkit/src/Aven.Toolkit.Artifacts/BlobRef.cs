namespace Aven.Toolkit.Artifacts;

public sealed record BlobRef(
    string Algorithm,
    string Hash,
    long SizeBytes);