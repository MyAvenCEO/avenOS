using System.Text.Json;
using System.Runtime.CompilerServices;
using Aven.Contracts.Protocol.Envelopes;
using Aven.Contracts.Protocol;
namespace Aven.Tests.Contracts;

public class ContractsPhase01Tests
{
    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void CapabilityGrant_hash_is_stable_for_set_order()
    {
        var left = CreateGrant(new[] { "metadata.record.create", "artifact.revision.create", "metadata.record.read" });
        var right = CreateGrant(new[] { "metadata.record.read", "metadata.record.create", "artifact.revision.create" });

        Assert.Equal(new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer().Hash(left), new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer().Hash(right));
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void ArtifactHandle_hash_is_stable_for_allowed_use_order()
    {
        var left = new FoundationArtifactHandle("artifact-handle-1", "artifact-1", "revision-1", new HashSet<string>(StringComparer.Ordinal) { "read", "evidence" });
        var right = new FoundationArtifactHandle("artifact-handle-1", "artifact-1", "revision-1", new HashSet<string>(StringComparer.Ordinal) { "evidence", "read" });

        Assert.Equal(new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer().Hash(left), new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer().Hash(right));
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void MetadataHandle_hash_is_stable_for_allowed_use_order()
    {
        var left = new FoundationMetadataHandle("metadata-handle-1", "record-1", "schema-1", new HashSet<string>(StringComparer.Ordinal) { "read", "source" });
        var right = new FoundationMetadataHandle("metadata-handle-1", "record-1", "schema-1", new HashSet<string>(StringComparer.Ordinal) { "source", "read" });

        Assert.Equal(new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer().Hash(left), new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer().Hash(right));
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Envelope_payload_hash_uses_canonical_json_not_raw_request_text()
    {
        var rawRequestText = """
            {"payload":{"z":true,"a":1.0}}
            """;
        var differentlyFormattedRequestText = """
            { "payload" : { "a" : 1, "z" : true } }
            """;

        using var left = JsonDocument.Parse(rawRequestText);
        using var right = JsonDocument.Parse(differentlyFormattedRequestText);

        var leftPayload = left.RootElement.GetProperty("payload").GetRawText();
        var rightPayload = right.RootElement.GetProperty("payload").GetRawText();

        Assert.NotEqual(leftPayload, rightPayload);
        var serializer = new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer();
        Assert.Equal(serializer.HashJson(leftPayload), serializer.HashJson(rightPayload));
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Metadata_value_and_schema_hash_use_canonical_json()
    {
        var valueLeft = """{"name":"Aven","score":1.0}""";
        var valueRight = """{"score":1,"name":"Aven"}""";
        var schemaLeft = """{"type":"object","required": ["name"],"properties":{"name":{"type":"string"}}}""";
        var schemaRight = """{"properties":{"name":{"type":"string"}},"required":["name"],"type":"object"}""";

        var serializer = new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer();
        Assert.Equal(serializer.HashJson(valueLeft), serializer.HashJson(valueRight));
        Assert.Equal(serializer.HashJson(schemaLeft), serializer.HashJson(schemaRight));
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Evidence_locator_json_is_canonicalized_or_rejected()
    {
        var left = """{"artifactId":"a1","revisionId":"r1","paths": ["$.a", "$.b"]}""";
        var right = """{"revisionId":"r1","paths":["$.a","$.b"],"artifactId":"a1"}""";

        var serializer = new Aven.Toolkit.Core.Serialization.CanonicalJsonSerializer();
        Assert.Equal(serializer.HashJson(left), serializer.HashJson(right));
        Assert.Throws<JsonException>(() => serializer.HashJson("""{"artifactId":"a1","artifactId":"a2"}"""));
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void SameRequestIdDifferentCaller_ProducesDifferentOperationKeys()
    {
        var requestId = new RequestId("req-001");

        var left = new OperationKey(new ActorAddress("agent/a", "local"), requestId, "artifact.create");
        var right = new OperationKey(new ActorAddress("agent/b", "local"), requestId, "artifact.create");

        Assert.NotEqual(left, right);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void SameRequestIdDifferentOperationType_ProducesDifferentOperationKeys()
    {
        var caller = new ActorAddress("agent/a", "local");
        var requestId = new RequestId("req-001");

        var left = new OperationKey(caller, requestId, "artifact.create");
        var right = new OperationKey(caller, requestId, "artifact.append");

        Assert.NotEqual(left, right);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void ContractRecordsRoundTripThroughJsonSerialization()
    {
        var envelope = new AvenEnvelope<SamplePayload>(
            new CommandId("cmd-001"),
            new MessageId("msg-001"),
            new ActorAddress("sender/1", "local"),
            new ActorAddress("recipient/1", "local"),
            new ActorAddress("reply/1", "local"),
            new CorrelationId("corr-001"),
            "sample.message",
            1,
            new SamplePayload("hello", 42),
            new CapabilityId("cap-001"),
            new MessageId("cause-001"),
            new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero));

        var json = JsonSerializer.Serialize(envelope);
        var roundTripped = JsonSerializer.Deserialize<AvenEnvelope<SamplePayload>>(json);

        Assert.NotNull(roundTripped);
        Assert.Equal(envelope, roundTripped);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void AvenEnvelopeBuilder_BuildsExpectedEnvelope()
    {
        var operationKey = new OperationKey(new ActorAddress("sender/1", "local"), new RequestId("req-001"), ResourceOperationTypes.LlmGenerate);
        var envelope = AvenEnvelopeBuilder
            .ForMessage(ResourceOperationTypes.LlmGenerate, "{\"prompt\":\"hello\"}")
            .From(new ActorAddress("sender/1", "local"))
            .To(new ActorAddress("recipient/1", "local"))
            .ReplyTo(new ActorAddress("reply/1", "local"))
            .WithCorrelation(new CorrelationId("corr-001"))
            .WithCausation(new MessageId("cause-001"))
            .WithCapability(new CapabilityId("cap-001"))
            .WithIdempotencyKey(operationKey)
            .WithMessageId(new MessageId("msg-001"))
            .WithCreatedAt(new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero))
            .Build();

        Assert.Equal(ResourceOperationTypes.LlmGenerate, envelope.MessageType);
        Assert.Equal("sender/1", envelope.Sender.Value);
        Assert.Equal("recipient/1", envelope.Recipient.Value);
        Assert.Equal("reply/1", envelope.ReplyTo.Value);
        Assert.Equal("corr-001", envelope.CorrelationId.Value);
        Assert.Equal("cap-001", envelope.CapabilityId?.Value);
        Assert.Equal("cause-001", envelope.CausationId?.Value);
        Assert.Equal("local|sender/1|req-001|llm.generate", envelope.CommandId.Value);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void AvenEnvelopeBuilder_MissingSender_Fails()
    {
        var builder = AvenEnvelopeBuilder
            .ForMessage("sample.message", "payload")
            .To(new ActorAddress("recipient/1", "local"))
            .ReplyTo(new ActorAddress("reply/1", "local"))
            .WithCorrelation(new CorrelationId("corr-001"))
            .WithCommandId(new CommandId("cmd-001"))
            .WithMessageId(new MessageId("msg-001"))
            .WithCreatedAt(DateTimeOffset.UtcNow);

        Assert.Throws<InvalidOperationException>(() => builder.Build());
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void AvenEnvelopeBuilder_MissingRecipient_Fails()
    {
        var builder = AvenEnvelopeBuilder
            .ForMessage("sample.message", "payload")
            .From(new ActorAddress("sender/1", "local"))
            .ReplyTo(new ActorAddress("reply/1", "local"))
            .WithCorrelation(new CorrelationId("corr-001"))
            .WithCommandId(new CommandId("cmd-001"))
            .WithMessageId(new MessageId("msg-001"))
            .WithCreatedAt(DateTimeOffset.UtcNow);

        Assert.Throws<InvalidOperationException>(() => builder.Build());
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void AvenEnvelopeBuilder_MissingReplyTo_Fails()
    {
        var builder = AvenEnvelopeBuilder
            .ForMessage("sample.message", "payload")
            .From(new ActorAddress("sender/1", "local"))
            .To(new ActorAddress("recipient/1", "local"))
            .WithCorrelation(new CorrelationId("corr-001"))
            .WithCommandId(new CommandId("cmd-001"))
            .WithMessageId(new MessageId("msg-001"))
            .WithCreatedAt(DateTimeOffset.UtcNow);

        Assert.Throws<InvalidOperationException>(() => builder.Build());
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void AvenEnvelopeBuilder_MissingMessageType_Fails()
    {
        Assert.Throws<ArgumentException>(() => AvenEnvelopeBuilder.ForMessage<string>(string.Empty, "payload"));
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void ContractsProject_DoesNotReferenceAkka()
    {
        var projectFile = Path.Combine(FindRepoRoot(), "Aven", "src", "Aven.Contracts", "Aven.Contracts.csproj");

        var contents = File.ReadAllText(projectFile);

        Assert.DoesNotContain("Akka", contents, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("PackageReference", contents, StringComparison.OrdinalIgnoreCase);
    }

    private static string FindRepoRoot([CallerFilePath] string sourceFile = "")
    {
        foreach (var start in new[] { Path.GetDirectoryName(sourceFile), Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = string.IsNullOrWhiteSpace(start) ? null : new DirectoryInfo(start);
            while (current is not null)
            {
                if (File.Exists(Path.Combine(current.FullName, "Aven.sln")))
                {
                    return current.FullName;
                }

                current = current.Parent;
            }
        }

        throw new InvalidOperationException("Could not locate repository root containing Aven.sln.");
    }

    private sealed record SamplePayload(string Text, int Count);

    private static CapabilityGrant CreateGrant(IEnumerable<string> allowedMessageTypes)
        => new(
            new CapabilityId("cap-001"),
            new ActorAddress("holder/1", "local"),
            new ActorAddress("target/1", "local"),
            allowedMessageTypes.ToHashSet(StringComparer.Ordinal),
            new CapabilityConstraints(MaxUses: 3),
            false,
            null,
            new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero),
            null);

    private sealed record FoundationArtifactHandle(string HandleId, string ArtifactId, string RevisionId, IReadOnlySet<string> AllowedUses);
    private sealed record FoundationMetadataHandle(string HandleId, string RecordId, string SchemaRef, IReadOnlySet<string> AllowedUses);
}