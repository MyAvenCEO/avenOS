namespace Aven.Toolkit.Artifacts;

public sealed record ArtifactIntegrityReport(
    DateTimeOffset CheckedAt,
    bool VerifyBytes,
    int ArtifactCount,
    int RevisionCount,
    int ReferencedBlobCount,
    int BlobRowCount,
    int BlobFileCount,
    ArtifactIntegrityIssue[] Issues)
{
    public bool Healthy => Issues.Length == 0;
}