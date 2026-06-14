namespace Aven.Toolkit.Llm;

public sealed record ArtifactSourceDescriptor(
    ArtifactRef Artifact,
    string Filename,
    string MimeType,
    BlobRef Blob,
    string? InlineText = null,
    string? InlineDataUrl = null);
