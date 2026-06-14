using System.Text.Json;
using Aven.Roles.Support;
using ToolkitArtifactRef = Aven.Toolkit.Artifacts.ArtifactRef;

namespace Aven.Tests.RoleAgents;

public sealed class RoleOperationFactoryRailsTests
{
    [Fact]
    public void TypedFactories_CreateExpectedIntentSpecificOperations()
    {
        var correlationId = new CorrelationId("corr-role-op-factories");

        var llm = RoleBehaviorSupport.LlmExtraction(
            "llm-1",
            correlationId,
            new LlmGenerateOperationPayload("llm-1", new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId("artifact-1")), new SchemaRef("schema://accounting/invoice@3"), "Extract fields", "invoice_extraction", null));
        var metadata = RoleBehaviorSupport.MetadataWrite(
            "meta-1",
            correlationId,
            new MetadataWriteOperationPayload("meta-1", "artifact-revision", "rev-1", new SchemaRef("schema://accounting/invoice@3"), "{}", "source"));
        var create = RoleBehaviorSupport.ArtifactCreate(
            "artifact-create-1",
            correlationId,
            new ArtifactWriteOperationPayload("artifact-create-1", new ArtifactId("artifact-2"), false, "invoice.json", "application/json", "accounting.invoice", "{}", SchemaRef: new SchemaRef("schema://accounting/invoice@3"), EvidenceJson: "{}"));
        var append = RoleBehaviorSupport.ArtifactAppend(
            "artifact-append-1",
            correlationId,
            new ArtifactWriteOperationPayload("artifact-append-1", new ArtifactId("artifact-2"), true, "invoice.json", "application/json", "accounting.invoice", "{}", SchemaRef: new SchemaRef("schema://accounting/invoice@3"), EvidenceJson: "{}"));
        var human = RoleBehaviorSupport.HumanPrompt(
            "human-1",
            correlationId,
            new HumanPromptOperationPayload("human-1", "Approve?", "cap-1"));
        var schedule = RoleBehaviorSupport.Schedule(
            "schedule-1",
            correlationId,
            new ScheduledWorkOperationPayload("schedule-1", "schedule-1", new ActorAddress("agent/test", "local"), "research.run_digest", "{}", DateTimeOffset.UtcNow.AddMinutes(5), correlationId, "summary", null));

        Assert.Equal(("llm", "llm.generate"), (llm.ProviderKind, llm.TargetOperationType));
        Assert.Equal(("metadata", "metadata.create"), (metadata.ProviderKind, metadata.TargetOperationType));
        Assert.Equal(("artifact", "artifact.create"), (create.ProviderKind, create.TargetOperationType));
        Assert.Equal(("artifact", "artifact.append"), (append.ProviderKind, append.TargetOperationType));
        Assert.Equal(("human", "human.approve"), (human.ProviderKind, human.TargetOperationType));
        Assert.Equal(("schedule", "schedule.create"), (schedule.ProviderKind, schedule.TargetOperationType));

        using var createJson = JsonDocument.Parse(create.Payload.Json);
        using var appendJson = JsonDocument.Parse(append.Payload.Json);
        Assert.False(createJson.RootElement.GetProperty("Append").GetBoolean());
        Assert.True(appendJson.RootElement.GetProperty("Append").GetBoolean());
    }

    [Fact]
    public void ArtifactCreate_RejectsAppendPayload()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            RoleBehaviorSupport.ArtifactCreate(
                "artifact-create-invalid",
                new CorrelationId("corr-artifact-create-invalid"),
                new ArtifactWriteOperationPayload("artifact-create-invalid", new ArtifactId("artifact-3"), true, "invoice.json", "application/json", "accounting.invoice", "{}", SchemaRef: new SchemaRef("schema://accounting/invoice@3"), EvidenceJson: "{}")));

        Assert.Contains("Append=false", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ArtifactAppend_RejectsNonAppendPayload()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            RoleBehaviorSupport.ArtifactAppend(
                "artifact-append-invalid",
                new CorrelationId("corr-artifact-append-invalid"),
                new ArtifactWriteOperationPayload("artifact-append-invalid", new ArtifactId("artifact-3"), false, "invoice.json", "application/json", "accounting.invoice", "{}", SchemaRef: new SchemaRef("schema://accounting/invoice@3"), EvidenceJson: "{}")));

        Assert.Contains("Append=true", ex.Message, StringComparison.Ordinal);
    }
}