namespace Aven.Toolkit.Artifacts;

public sealed record StoredBlob(
    BlobRef Blob,
    string StorageRef,
    string MimeType,
    DateTimeOffset CreatedAt);