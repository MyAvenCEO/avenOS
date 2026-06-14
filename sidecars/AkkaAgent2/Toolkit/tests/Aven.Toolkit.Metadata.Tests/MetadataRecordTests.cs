using Aven.Toolkit.Core.Identifiers;

namespace Aven.Toolkit.Metadata.Tests;

public sealed class MetadataRecordTests
{
    [Fact]
    public void MetadataRecord_And_Subject_Preserve_All_Public_Fields()
    {
        var createdAt = new DateTimeOffset(2026, 6, 10, 12, 34, 56, TimeSpan.Zero);
        var subject = new MetadataSubject(
            Kind: "artifact",
            Id: "artifact-1",
            ArtifactId: new ArtifactId("artifact-1"),
            ArtifactRevisionId: new ArtifactRevisionId("revision-1"),
            RoleAgentId: new RoleAgentId("agent-1"),
            PromptId: new PromptId("prompt-1"),
            ExternalSourceId: "external-42");
        var record = new MetadataRecord(
            "record-1",
            subject,
            new SchemaRef("schema://invoice@1"),
            "{\"invoiceId\":\"inv-1\"}",
            "hash-1",
            createdAt,
            SourceSummary: "imported");

        Assert.Equal("record-1", record.RecordId);
        Assert.Equal(subject, record.Subject);
        Assert.Equal("schema://invoice@1", record.SchemaRef.Value);
        Assert.Equal("{\"invoiceId\":\"inv-1\"}", record.Json);
        Assert.Equal("hash-1", record.PayloadHash);
        Assert.Equal(createdAt, record.CreatedAt);
        Assert.Equal("imported", record.SourceSummary);

        Assert.Equal("artifact", subject.Kind);
        Assert.Equal("artifact-1", subject.Id);
        Assert.Equal("artifact-1", subject.ArtifactId!.Value.Value);
        Assert.Equal("revision-1", subject.ArtifactRevisionId!.Value.Value);
        Assert.Equal("agent-1", subject.RoleAgentId!.Value.Value);
        Assert.Equal("prompt-1", subject.PromptId!.Value.Value);
        Assert.Equal("external-42", subject.ExternalSourceId);
    }

    [Fact]
    public void MetadataValidationResult_Failure_CapturesErrors()
    {
        var result = MetadataValidationResult.Failure("schema mismatch", "missing field");

        Assert.False(result.Succeeded);
        Assert.Equal(2, result.Errors.Count);
    }

    [Fact]
    public void MetadataValidationResult_Success_Uses_Empty_Error_List()
    {
        var result = MetadataValidationResult.Success;

        Assert.True(result.Succeeded);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void MetadataQueryResult_PreservesRecordsAndLimit()
    {
        var record = new MetadataRecord(
            "record-1",
            new MetadataSubject("artifact", "artifact-1", new ArtifactId("artifact-1")),
            new SchemaRef("schema://invoice@1"),
            "{}",
            "hash-1",
            DateTimeOffset.UtcNow);

        var result = new MetadataQueryResult([record], TimedOut: false, AppliedLimit: 25);

        Assert.Single(result.Records);
        Assert.Equal(25, result.AppliedLimit);
    }
}