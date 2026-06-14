using Aven.Toolkit.Core.Identifiers;

namespace Aven.Toolkit.Metadata.Tests;

public sealed class MetadataQueryTests
{
    [Fact]
    public void InMemoryMetadataStore_Filters_By_Subject_And_Schema()
    {
        var store = new InMemoryMetadataStore();
        var invoiceSchema = new SchemaRef("schema://invoice@1");
        var matchSchema = new SchemaRef("schema://match@1");

        store.Add(new MetadataRecord(
            "record-1",
            new MetadataSubject("artifact", "artifact-1", new ArtifactId("artifact-1")),
            invoiceSchema,
            "{}",
            "hash-1",
            DateTimeOffset.UtcNow));
        store.Add(new MetadataRecord(
            "record-2",
            new MetadataSubject("artifact", "artifact-1", new ArtifactId("artifact-1")),
            matchSchema,
            "{}",
            "hash-2",
            DateTimeOffset.UtcNow));

        var result = store.Query(new MetadataQuery(
            SubjectKind: "artifact",
            SubjectId: "artifact-1",
            SchemaRef: invoiceSchema,
            Limit: 10));

        var record = Assert.Single(result.Records);
        Assert.Equal("record-1", record.RecordId);
        Assert.False(result.TimedOut);
    }

    [Fact]
    public void InMemoryMetadataStore_Filters_By_Subject_And_Schema_Lists()
    {
        var store = new InMemoryMetadataStore();
        var invoiceSchema = new SchemaRef("schema://invoice@1");
        var matchSchema = new SchemaRef("schema://match@1");

        store.Add(new MetadataRecord(
            "record-1",
            new MetadataSubject("artifact", "artifact-1", new ArtifactId("artifact-1")),
            invoiceSchema,
            "{}",
            "hash-1",
            DateTimeOffset.UtcNow));
        store.Add(new MetadataRecord(
            "record-2",
            new MetadataSubject("payment-match", "match-1", new ArtifactId("artifact-2")),
            matchSchema,
            "{}",
            "hash-2",
            DateTimeOffset.UtcNow));

        var result = store.Query(new MetadataQuery(
            SubjectKinds: ["payment-match", "artifact"],
            SubjectIds: ["match-1"],
            SchemaRefs: [matchSchema],
            Limit: 10));

        var record = Assert.Single(result.Records);
        Assert.Equal("record-2", record.RecordId);
    }

    [Fact]
    public void InMemoryMetadataStore_Honors_Timeout_And_Limit()
    {
        var store = new InMemoryMetadataStore();
        for (var index = 0; index < 3; index++)
        {
            store.Add(new MetadataRecord(
                $"record-{index}",
                new MetadataSubject("artifact", $"artifact-{index}", new ArtifactId($"artifact-{index}")),
                new SchemaRef("schema://invoice@1"),
                "{}",
                $"hash-{index}",
                DateTimeOffset.UtcNow));
        }

        var limited = store.Query(new MetadataQuery(Limit: 2));
        Assert.Equal(2, limited.Records.Count);
        Assert.False(limited.TimedOut);

        var timedOut = store.Query(new MetadataQuery(Limit: 2, Timeout: TimeSpan.Zero));
        Assert.True(timedOut.TimedOut);
    }
}
