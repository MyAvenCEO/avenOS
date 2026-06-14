using System.Text.Json;
using Aven.Roles.Models;
using Aven.Roles.ResearchWatch;

namespace Aven.Tests.RoleAgents;

public sealed class Phase25RoleCapabilityIdentityTests
{
    [Fact]
    public void ContractWatcherRoleBehavior_EmitsAgentScopedCapabilityIds()
    {
        var handler = Assert.IsAssignableFrom<Aven.Roles.Interfaces.IRoleBehaviorHandler>(BuiltInRoleBehaviorCatalog.GetHandler("contract_watcher"));
        var agentId = new RoleAgentId("agent-contract-a");

        var ingest = handler.Apply(
            CreateResolved(
                caller: new ActorAddress("intake/contract", "local"),
                requestId: "contract-scoped-input",
                operationType: "contracts.ingest_document",
                correlationId: "corr-contract-scoped-input",
                payloadJson: JsonSerializer.Serialize(CreateContractCommand(agentId, "claim-contract-scoped", "contract-source-artifact"))),
            new RoleBehaviorContext(agentId, handler.CreateInitialStateJson(), Array.Empty<RoleOperation>()));

        var llmPayload = JsonSerializer.Deserialize<LlmGenerateOperationPayload>(Assert.Single(ingest.OperationsToRequest).Payload.Json)
            ?? throw new InvalidOperationException("Missing contract LLM payload.");
        Assert.Equal("agent-contract-a:llm-contract", llmPayload.CapabilityId);

        var extracted = handler.Apply(
            CreateResolved(
                caller: new ActorAddress("resource/llm", "local"),
                requestId: Assert.Single(ingest.OperationsToRequest).RequestId,
                operationType: "llm.generate",
                correlationId: "corr-contract-scoped-extract",
                payloadJson: ContractExtractionJson()),
            new RoleBehaviorContext(agentId, ingest.RoleStateJson, ingest.OperationsToRequest));

        var capabilityIds = extracted.OperationsToRequest.Select(ExtractCapabilityId).ToArray();
        Assert.All(capabilityIds, id => Assert.StartsWith("agent-contract-a:", id, StringComparison.Ordinal));
        Assert.Contains("agent-contract-a:contract-summary", capabilityIds);
        Assert.Contains("agent-contract-a:contract-renewal", capabilityIds);
        Assert.Contains("agent-contract-a:contract-reminder", capabilityIds);
    }

    [Fact]
    public void ResearchWatchRoleBehavior_EmitsAgentScopedCapabilityIds()
    {
        var handler = Assert.IsAssignableFrom<Aven.Roles.Interfaces.IRoleBehaviorHandler>(BuiltInRoleBehaviorCatalog.GetHandler("research_watch"));
        var agentId = new RoleAgentId("agent-research-a");

        var ingest = handler.Apply(
            CreateResolved(
                caller: new ActorAddress("intake/research", "local"),
                requestId: "research-scoped-input",
                operationType: "research.ingest_document",
                correlationId: "corr-research-scoped-input",
                payloadJson: JsonSerializer.Serialize(CreateResearchCommand(agentId, "claim-research-scoped", "research-source-artifact"))),
            new RoleBehaviorContext(agentId, handler.CreateInitialStateJson(), Array.Empty<RoleOperation>()));

        var llmPayload = JsonSerializer.Deserialize<LlmGenerateOperationPayload>(Assert.Single(ingest.OperationsToRequest).Payload.Json)
            ?? throw new InvalidOperationException("Missing research LLM payload.");
        Assert.Equal("agent-research-a:llm-research", llmPayload.CapabilityId);

        var extracted = handler.Apply(
            CreateResolved(
                caller: new ActorAddress("resource/llm", "local"),
                requestId: Assert.Single(ingest.OperationsToRequest).RequestId,
                operationType: "llm.generate",
                correlationId: "corr-research-scoped-extract",
                payloadJson: ResearchExtractionJson()),
            new RoleBehaviorContext(agentId, ingest.RoleStateJson, ingest.OperationsToRequest));

        var capabilityIds = extracted.OperationsToRequest.Select(ExtractCapabilityId).ToArray();
        Assert.All(capabilityIds, id => Assert.StartsWith("agent-research-a:", id, StringComparison.Ordinal));
        Assert.Contains("agent-research-a:research-metadata", capabilityIds);
        Assert.Contains("agent-research-a:research-schedule", capabilityIds);
    }

    private static string ExtractCapabilityId(RoleOperation operation) => operation.TargetOperationType switch
    {
        "llm.generate" => JsonSerializer.Deserialize<LlmGenerateOperationPayload>(operation.Payload.Json)?.CapabilityId
                          ?? throw new InvalidOperationException($"Missing LLM capability id for {operation.RequestId}.'"),
        "metadata.create" => JsonSerializer.Deserialize<MetadataWriteOperationPayload>(operation.Payload.Json)?.CapabilityId
                             ?? throw new InvalidOperationException($"Missing metadata capability id for {operation.RequestId}.'"),
        "schedule.create" => JsonSerializer.Deserialize<ScheduledWorkOperationPayload>(operation.Payload.Json)?.CapabilityId
                             ?? throw new InvalidOperationException($"Missing schedule capability id for {operation.RequestId}.'"),
        _ => throw new InvalidOperationException($"Unexpected operation type '{operation.TargetOperationType}'.")
    };

    private static ContractWatcherDocumentCommand CreateContractCommand(RoleAgentId agentId, string claimId, string incomingItemRef) =>
        new(
            new RoutingAttemptId($"route-{claimId}"),
            new WorkOfferId($"offer-{claimId}"),
            new WorkClaimId(claimId),
            agentId,
            incomingItemRef,
            [incomingItemRef],
            "lease renewal packet",
            "contracts.renewal",
            "contract upload",
            [new SchemaRef("schema://contracts/contract-summary@1")],
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/contracts", "local"));

    private static ResearchWatchDocumentCommand CreateResearchCommand(RoleAgentId agentId, string claimId, string incomingItemRef) =>
        new(
            new RoutingAttemptId($"route-{claimId}"),
            new WorkOfferId($"offer-{claimId}"),
            new WorkClaimId(claimId),
            agentId,
            incomingItemRef,
            [incomingItemRef],
            "research summary packet",
            "research.document",
            "research upload",
            [new SchemaRef("schema://research/document-summary@1")],
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/research", "local"));

    private static OperationResolved CreateResolved(ActorAddress caller, string requestId, string operationType, string correlationId, string payloadJson) =>
        new(
            new OperationKey(caller, new RequestId(requestId), operationType),
            new CorrelationId(correlationId),
            caller,
            caller,
            new OperationValue(operationType, payloadJson));

    private static string ContractExtractionJson() =>
        "{\"structuredJson\":{\"contractId\":\"CONTRACT-100\",\"renewalDate\":\"2030-01-01T00:00:00Z\",\"reminderText\":\"Review contract CONTRACT-100\",\"renewalTermJson\":{\"contractId\":\"CONTRACT-100\",\"renewalDate\":\"2030-01-01T00:00:00Z\"}},\"artifactId\":\"contract-source-artifact\",\"revisionId\":\"contract-source-revision\"}";

    private static string ResearchExtractionJson() =>
        "{\"structuredJson\":{\"paperId\":\"PAPER-100\",\"topic\":\"battery chemistry\",\"digestDueAt\":\"2030-01-01T00:00:00Z\"},\"artifactId\":\"research-source-artifact\",\"revisionId\":\"research-source-revision\"}";
}