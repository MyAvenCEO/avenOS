namespace Aven.Api.Responses;

public sealed record ArtifactUploadResponse(string ArtifactId, string RevisionId, string Filename, string MimeType);
