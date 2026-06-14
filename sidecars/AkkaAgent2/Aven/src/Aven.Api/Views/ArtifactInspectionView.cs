namespace Aven.Api.Views;

public sealed record ArtifactInspectionView(
    string ArtifactId,
    string CurrentRevisionId,
    string Filename,
    string MimeType,
    string SourceKind,
    DateTimeOffset CreatedAt,
    ArtifactRevisionView[] Revisions);

public sealed record ArtifactRevisionView(
    string RevisionId,
    string Algorithm,
    string Hash,
    long SizeBytes,
    DateTimeOffset CreatedAt,
    string? Description);
