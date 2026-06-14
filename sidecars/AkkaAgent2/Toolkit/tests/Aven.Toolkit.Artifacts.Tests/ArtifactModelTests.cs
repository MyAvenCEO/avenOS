using Aven.Toolkit.Core.Identifiers;

namespace Aven.Toolkit.Artifacts.Tests;

public sealed class ArtifactModelTests
{
    [Fact]
    public void Artifact_models_preserve_constructor_values()
    {
        var artifactId = new ArtifactId("artifact-1");
        var revisionId = new ArtifactRevisionId("revision-1");
        var blob = new BlobRef("sha256", new string('a', 64), 42);
        var createdAt = new DateTimeOffset(2026, 6, 10, 12, 34, 56, TimeSpan.Zero);
        var revision = new ArtifactRevisionDescriptor(revisionId, blob, createdAt, "initial revision");
        var descriptor = new ArtifactDescriptor(
            artifactId,
            revisionId,
            "invoice.pdf",
            "application/pdf",
            "upload",
            createdAt,
            [revision]);
        var issue = new ArtifactIntegrityIssue("missing-blob", "error", artifactId, revisionId, blob, "blob row missing");
        var report = new ArtifactIntegrityReport(createdAt, VerifyBytes: true, 1, 1, 1, 1, 1, [issue]);
        var query = new ArtifactQuery("invoice", "application/pdf", "upload", 25);
        var storedBlob = new StoredBlob(blob, "sha256/aa/aa/aaaaaaaa", "application/pdf", createdAt);

        Assert.Equal(artifactId, descriptor.ArtifactId);
        Assert.Equal(revisionId, descriptor.CurrentRevisionId);
        Assert.Equal("invoice.pdf", descriptor.Filename);
        Assert.Equal("application/pdf", descriptor.MimeType);
        Assert.Equal("upload", descriptor.SourceKind);
        Assert.Equal(createdAt, descriptor.CreatedAt);
        Assert.Single(descriptor.Revisions);
        Assert.Equal(revision, descriptor.Revisions[0]);

        Assert.Equal("missing-blob", issue.Code);
        Assert.Equal("error", issue.Severity);
        Assert.Equal(artifactId, issue.ArtifactId);
        Assert.Equal(revisionId, issue.RevisionId);
        Assert.Equal(blob, issue.Blob);
        Assert.Equal("blob row missing", issue.Message);

        Assert.Equal(createdAt, report.CheckedAt);
        Assert.True(report.VerifyBytes);
        Assert.Equal(1, report.ArtifactCount);
        Assert.Equal(1, report.RevisionCount);
        Assert.Equal(1, report.ReferencedBlobCount);
        Assert.Equal(1, report.BlobRowCount);
        Assert.Equal(1, report.BlobFileCount);
        Assert.Single(report.Issues);
        Assert.False(report.Healthy);

        Assert.Equal("invoice", query.FilenameContains);
        Assert.Equal("application/pdf", query.MimeType);
        Assert.Equal("upload", query.SourceKind);
        Assert.Equal(25, query.Limit);

        Assert.Equal(blob, storedBlob.Blob);
        Assert.Equal("sha256/aa/aa/aaaaaaaa", storedBlob.StorageRef);
        Assert.Equal("application/pdf", storedBlob.MimeType);
        Assert.Equal(createdAt, storedBlob.CreatedAt);
    }

    [Fact]
    public void Artifact_integrity_report_is_healthy_when_no_issues_exist()
    {
        var report = new ArtifactIntegrityReport(
            new DateTimeOffset(2026, 6, 10, 12, 0, 0, TimeSpan.Zero),
            VerifyBytes: false,
            ArtifactCount: 0,
            RevisionCount: 0,
            ReferencedBlobCount: 0,
            BlobRowCount: 0,
            BlobFileCount: 0,
            Issues: []);

        Assert.True(report.Healthy);
    }

    [Fact]
    public void Artifact_revision_descriptor_preserves_constructor_values()
    {
        var revisionId = new ArtifactRevisionId("revision-2");
        var blob = new BlobRef("sha256", new string('b', 64), 99);
        var createdAt = new DateTimeOffset(2026, 6, 11, 8, 9, 10, TimeSpan.Zero);

        var revision = new ArtifactRevisionDescriptor(revisionId, blob, createdAt, "follow-up revision");

        Assert.Equal(revisionId, revision.RevisionId);
        Assert.Equal(blob, revision.Blob);
        Assert.Equal(createdAt, revision.CreatedAt);
        Assert.Equal("follow-up revision", revision.Description);
    }
}