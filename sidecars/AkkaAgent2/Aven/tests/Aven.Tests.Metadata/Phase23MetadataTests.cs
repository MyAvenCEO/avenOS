using Aven.Resources.Metadata;
using System.Text.Json;
using Akka.Actor;
using Akka.Configuration;

namespace Aven.Tests.Metadata;

public sealed class Phase23MetadataTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase23-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public void CreateInvoiceMetadata_WithSchemaValidation_Succeeds()
    {
        var gateway = CreateProvider();
        var reply = gateway.Create(CreateRequest("invoice-1", "req-1", "{\"invoiceNumber\":\"INV-1\"}"));

        var succeeded = Assert.IsType<MetadataCreateSucceeded>(reply);
        Assert.False(succeeded.Idempotent);
        Assert.Equal("schema://accounting/invoice@3", succeeded.Record.SchemaRef.Value);
    }

    [Fact]
    public void SameOperationKey_SamePayload_ReturnsExistingRecord()
    {
        var gateway = CreateProvider();
        var request = CreateRequest("invoice-1", "req-2", "{\"invoiceNumber\":\"INV-1\"}");

        var first = Assert.IsType<MetadataCreateSucceeded>(gateway.Create(request));
        var second = Assert.IsType<MetadataCreateSucceeded>(gateway.Create(request));

        Assert.False(first.Idempotent);
        Assert.True(second.Idempotent);
        Assert.Equal(first.Record.RecordId, second.Record.RecordId);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void SameOperationKey_SemanticallySameJson_ReturnsExistingRecord()
    {
        var gateway = CreateProvider();
        var firstRequest = CreateRequest("invoice-1", "req-canonical", "{\"invoiceNumber\":\"INV-1\",\"amount\":1.0}");
        var secondRequest = CreateRequest("invoice-1", "req-canonical", "{\"amount\":1,\"invoiceNumber\":\"INV-1\"}");

        var first = Assert.IsType<MetadataCreateSucceeded>(gateway.Create(firstRequest));
        var second = Assert.IsType<MetadataCreateSucceeded>(gateway.Create(secondRequest));

        Assert.False(first.Idempotent);
        Assert.True(second.Idempotent);
        Assert.Equal(first.Record.RecordId, second.Record.RecordId);
        Assert.Equal(first.Record.PayloadHash, second.Record.PayloadHash);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void CreateMetadata_RejectsDuplicateJsonPropertiesAtBoundary()
    {
        var gateway = CreateProvider();

        Assert.Throws<JsonException>(() => gateway.Create(CreateRequest(
            "invoice-1",
            "req-duplicate-json-property",
            "{\"invoiceNumber\":\"INV-1\",\"invoiceNumber\":\"INV-2\"}")));
    }

    [Fact]
    public void SameOperationKey_DifferentPayload_Conflicts()
    {
        var gateway = CreateProvider();
        gateway.Create(CreateRequest("invoice-1", "req-3", "{\"invoiceNumber\":\"INV-1\"}"));

        var conflict = gateway.Create(CreateRequest("invoice-1", "req-3", "{\"invoiceNumber\":\"INV-2\"}"));

        var rejected = Assert.IsType<MetadataCreateConflict>(conflict);
        Assert.Equal("metadata_conflict", rejected.Error.Code);
    }

    [Fact]
    public void QueryBySubjectAndSchema_ReturnsBoundedResults()
    {
        var gateway = CreateProvider();
        gateway.Create(CreateRequest("invoice-1", "req-4a", "{\"invoiceNumber\":\"INV-1\"}"));
        gateway.Create(CreateRequest("invoice-1", "req-4b", "{\"invoiceNumber\":\"INV-1-B\"}", schemaRef: new SchemaRef("schema://accounting/payment-match@3")));
        gateway.Create(CreateRequest("invoice-2", "req-4c", "{\"invoiceNumber\":\"INV-2\"}"));

        var result = gateway.Query(new MetadataQuery(
            SubjectKind: "artifact-revision",
            SubjectId: "invoice-1",
            SchemaRef: new SchemaRef("schema://accounting/invoice@3"),
            Limit: 1));

        Assert.False(result.TimedOut);
        Assert.Equal(1, result.AppliedLimit);
        var record = Assert.Single(result.Records);
        Assert.Equal("invoice-1", record.Subject.Id);
        Assert.Equal("schema://accounting/invoice@3", record.SchemaRef.Value);
    }

    [Fact]
    public void QueryByListFilters_ReturnsMatchingRecords()
    {
        var gateway = CreateProvider();
        gateway.Create(CreateRequest("invoice-1", "req-4d", "{\"invoiceNumber\":\"INV-1\"}"));
        gateway.Create(CreateRequest("invoice-1", "req-4e", "{\"invoiceNumber\":\"INV-1-MATCH\"}", schemaRef: new SchemaRef("schema://accounting/payment-match@3")));
        gateway.Create(CreateRequest("invoice-2", "req-4f", "{\"invoiceNumber\":\"INV-2\"}"));

        var result = gateway.Query(new MetadataQuery(
            SubjectKinds: ["artifact-revision"],
            SubjectIds: ["invoice-1"],
            SchemaRefs: [new SchemaRef("schema://accounting/payment-match@3")],
            Limit: 10));

        Assert.False(result.TimedOut);
        var record = Assert.Single(result.Records);
        Assert.Equal("invoice-1", record.Subject.Id);
        Assert.Equal("schema://accounting/payment-match@3", record.SchemaRef.Value);
    }

    [Fact]
    public void QueryTimeoutAndLimit_AreEnforced()
    {
        var gateway = CreateProvider();
        for (var index = 0; index < 5; index++)
        {
            gateway.Create(CreateRequest($"invoice-{index}", $"req-5-{index}", $"{{\"invoiceNumber\":\"INV-{index}\"}}"));
        }

        var limited = gateway.Query(new MetadataQuery(Limit: 2));
        Assert.False(limited.TimedOut);
        Assert.Equal(2, limited.Records.Count);

        var timedOut = gateway.Query(new MetadataQuery(Limit: 2, Timeout: TimeSpan.Zero));
        Assert.True(timedOut.TimedOut);
        Assert.Empty(timedOut.Records);
    }

    [Fact]
    public void CreateMetadata_RequiresCapability_WhenAuthorityConfigured()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(new CapabilityGrant(
            new CapabilityId("metadata-create-cap"),
            new ActorAddress("agent/accountant", "local"),
            new ActorAddress("resource/metadata", "local"),
            new HashSet<string>(StringComparer.Ordinal) { "metadata.create" },
            new CapabilityConstraints(MaxUses: 10),
            false,
            null,
            DateTimeOffset.UtcNow.AddMinutes(5),
            null));
        var securedProvider = new InMemoryMetadataStoreClient((schemaRef, json) =>
        {
            if (schemaRef.Value == "schema://accounting/invoice@3" && json.Contains("invoiceNumber", StringComparison.Ordinal))
            {
                return MetadataValidationResult.Success;
            }

            return MetadataValidationResult.Failure("schema validation failed");
        }, authority);

        var reply = securedProvider.Create(CreateRequest("invoice-unauthorized", "req-capability-missing", "{\"invoiceNumber\":\"INV-1\"}"));

        var rejected = Assert.IsType<MetadataCreateRejected>(reply);
        Assert.Equal("capability_required", rejected.Error.Code);
    }

    [Fact]
    public async Task ActorBackedMetadataStore_Query_FiltersBySubjectSchemaAndLimit()
    {
        await WithSystem(async system =>
        {
            var client = new MetadataStoreClient(system, "phase23/metadata", ValidateMetadata);
            _ = client.Create(CreateRequest("invoice-a", "req-actor-a", "{\"invoiceNumber\":\"INV-A\"}"));
            _ = client.Create(CreateRequest("invoice-a", "req-actor-b", "{\"invoiceNumber\":\"INV-A-MATCH\"}", schemaRef: new SchemaRef("schema://accounting/payment-match@3")));
            _ = client.Create(CreateRequest("invoice-b", "req-actor-c", "{\"invoiceNumber\":\"INV-B\"}"));

            var result = client.Query(new MetadataQuery(
                SubjectKind: "artifact-revision",
                SubjectId: "invoice-a",
                SchemaRef: new SchemaRef("schema://accounting/invoice@3"),
                Limit: 1));

            Assert.False(result.TimedOut);
            Assert.Equal(1, result.AppliedLimit);
            var record = Assert.Single(result.Records);
            Assert.Equal("invoice-a", record.Subject.Id);
            Assert.Equal("schema://accounting/invoice@3", record.SchemaRef.Value);
            await Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ActorBackedMetadataStore_Query_FiltersByListFilters()
    {
        await WithSystem(async system =>
        {
            var client = new MetadataStoreClient(system, "phase23/metadata-list", ValidateMetadata);
            _ = client.Create(CreateRequest("invoice-a", "req-actor-list-a", "{\"invoiceNumber\":\"INV-A\"}"));
            _ = client.Create(CreateRequest("invoice-a", "req-actor-list-b", "{\"invoiceNumber\":\"INV-A-MATCH\"}", schemaRef: new SchemaRef("schema://accounting/payment-match@3")));
            _ = client.Create(CreateRequest("invoice-b", "req-actor-list-c", "{\"invoiceNumber\":\"INV-B\"}"));

            var result = client.Query(new MetadataQuery(
                SubjectKinds: ["artifact-revision"],
                SubjectIds: ["invoice-a"],
                SchemaRefs: [new SchemaRef("schema://accounting/payment-match@3")],
                Limit: 10));

            Assert.False(result.TimedOut);
            var record = Assert.Single(result.Records);
            Assert.Equal("invoice-a", record.Subject.Id);
            Assert.Equal("schema://accounting/payment-match@3", record.SchemaRef.Value);
            await Task.CompletedTask;
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        return Task.CompletedTask;
    }

    private async Task WithSystem(Func<ActorSystem, Task> action)
    {
        var config = ConfigurationFactory.ParseString($$"""
            akka {
              loglevel = WARNING
              stdout-loglevel = WARNING
              persistence {
                journal.plugin = "akka.persistence.journal.sqlite"
                snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
                journal.sqlite {
                  class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase23-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static IMetadataStoreClient CreateProvider() => new InMemoryMetadataStoreClient(ValidateMetadata);

    private static MetadataValidationResult ValidateMetadata(SchemaRef schemaRef, string json)
    {
        if (schemaRef.Value == "schema://accounting/invoice@3" && json.Contains("invoiceNumber", StringComparison.Ordinal))
        {
            return MetadataValidationResult.Success;
        }

        if (schemaRef.Value == "schema://accounting/payment-match@3" && json.Contains("invoiceNumber", StringComparison.Ordinal))
        {
            return MetadataValidationResult.Success;
        }

        return MetadataValidationResult.Failure("schema validation failed");
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private static MetadataCreateRequest CreateRequest(string subjectId, string requestId, string json, SchemaRef? schemaRef = null) =>
        new(
            new OperationKey(new ActorAddress("agent/accountant", "local"), new RequestId(requestId), "metadata.create"),
            new CorrelationId($"corr-{requestId}"),
            new MetadataSubject(
                Kind: "artifact-revision",
                Id: subjectId,
                ArtifactId: new Aven.Toolkit.Core.Identifiers.ArtifactId($"artifact-{subjectId}"),
                ArtifactRevisionId: new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId($"revision-{subjectId}")),
            schemaRef ?? new SchemaRef("schema://accounting/invoice@3"),
            json,
            SourceSummary: "phase23-test");
}