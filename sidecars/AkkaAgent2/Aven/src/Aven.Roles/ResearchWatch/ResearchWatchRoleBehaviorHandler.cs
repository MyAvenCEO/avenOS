using System.Text.Json;
using ToolkitArtifactRef = Aven.Toolkit.Artifacts.ArtifactRef;

namespace Aven.Roles.ResearchWatch;

internal sealed class ResearchWatchRoleBehaviorHandler : IRoleBehaviorHandler
{
    public string? CreateInitialStateJson() => JsonSerializer.Serialize(ResearchWatchRoleState.Empty);

    public bool CanHandle(OperationResolved resolved, RoleBehaviorContext context)
    {
        if (resolved.Key.OperationType is "research.ingest_document" or "research.run_digest")
        {
            return true;
        }

        var state = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ResearchWatchRoleState.Empty);
        var active = state.ReceivedDocuments.Count > 0 || state.LatestDocument is not null || state.DigestScheduleIds.Count > 0;
        return active && resolved.Key.OperationType is ResourceOperationTypes.LlmGenerate or ResourceOperationTypes.MetadataCreate or ResourceOperationTypes.ScheduleCreate;
    }

    public RoleBehaviorResult Apply(OperationResolved resolved, RoleBehaviorContext context) => resolved.Key.OperationType switch
    {
        "research.ingest_document" => ApplyIngest(RoleBehaviorSupport.Deserialize<ResearchWatchDocumentCommand>(resolved.Value.ValueJson, "Research watch intake command was empty."), context),
        "research.run_digest" => ApplyDigestKickoff(resolved, context),
        ResourceOperationTypes.LlmGenerate => ApplyExtraction(resolved, context),
        ResourceOperationTypes.MetadataCreate or ResourceOperationTypes.ScheduleCreate => ApplyCompletion(resolved, context),
        _ => new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, context.RoleStateJson, Array.Empty<RoleOperation>(), null)
    };

    public object CreateCommittedCommand(string expectedCommandType, RoleCommittedInput input) =>
        expectedCommandType switch
        {
            "research.run_digest" => new ResearchDigestCommand(
                new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(input.IncomingItemRef)),
                input.ContentSummary,
                input.ProposedIntent,
                DateTimeOffset.UtcNow,
                input.ProposedReason),
            _ => new ResearchWatchDocumentCommand(
                input.RoutingAttemptId,
                input.OfferId,
                input.ClaimId,
                input.RoleAgentId,
                input.IncomingItemRef,
                input.AttachmentRefs,
                input.ContentSummary,
                input.ProposedIntent,
                input.ProposedReason,
                input.RequiredSchemas,
                input.CorrelationId,
                input.ReplyTo)
        };

    private static RoleBehaviorResult ApplyIngest(ResearchWatchDocumentCommand command, RoleBehaviorContext context)
    {
        var state = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ResearchWatchRoleState.Empty);
        state = state with { ReceivedDocuments = state.ReceivedDocuments.Concat([command]).ToArray() };
        var requestId = $"research-extract-{command.ClaimId.Value}";
        var plan = new LlmGenerateOperationPayload(
            requestId,
            new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(command.IncomingItemRef)),
            new SchemaRef("schema://research/document-summary@1"),
            $"Summarize research document from {command.IncomingItemRef} into strict JSON.",
            "research.extract",
            RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "llm-research"));
        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(state), [RoleBehaviorSupport.LlmExtraction(requestId, command.CorrelationId, plan)], null);
    }

    private static RoleBehaviorResult ApplyDigestKickoff(OperationResolved resolved, RoleBehaviorContext context)
    {
        var command = RoleBehaviorSupport.Deserialize<ResearchDigestCommand>(resolved.Value.ValueJson, "Research watch digest command was empty.");
        var state = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ResearchWatchRoleState.Empty);
        var requestId = $"research-digest-{command.SubjectId}-{command.DueAt.UtcTicks}";
        var plan = new LlmGenerateOperationPayload(
            requestId,
            command.SourceArtifact,
            new SchemaRef("schema://research/digest@1"),
            $"Create a digest for research topic '{command.Topic}' from {command.SourceArtifact.ArtifactId.Value} into strict JSON.",
            "research.digest",
            RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "llm-research"));
        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(state), [RoleBehaviorSupport.LlmExtraction(requestId, resolved.CorrelationId, plan)], null);
    }

    private static RoleBehaviorResult ApplyExtraction(OperationResolved resolved, RoleBehaviorContext context)
    {
        var state = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ResearchWatchRoleState.Empty);
        var extracted = ParseResearchExtraction(resolved.Value.ValueJson, resolved.Key.RequestId.Value);
        state = state with { LatestDocument = extracted, LatestDigestJson = extracted.StructuredJson };
        var isDigestRun = resolved.Key.RequestId.Value.Contains("research-digest-", StringComparison.OrdinalIgnoreCase);

        using var parsed = JsonDocument.Parse(extracted.StructuredJson);
        var root = parsed.RootElement;
        var subjectId = root.TryGetProperty("paperId", out var paperId) ? paperId.GetString() ?? "RESEARCH-UNKNOWN" : "RESEARCH-UNKNOWN";
        var topic = root.TryGetProperty("topic", out var topicProperty) ? topicProperty.GetString() ?? "research" : "research";
        var sourceArtifactForDigest = state.ReceivedDocuments.LastOrDefault() is { } latestDocument
            ? new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(latestDocument.IncomingItemRef))
            : extracted.SourceArtifact;
        var dueAt = root.TryGetProperty("digestDueAt", out var digestDueAtProperty)
            && digestDueAtProperty.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(digestDueAtProperty.GetString(), out var parsedDueAt)
                ? parsedDueAt
                : DateTimeOffset.UtcNow.AddDays(7);
        if (isDigestRun)
        {
            var digestIntent = RoleBehaviorSupport.MetadataWrite(
                $"research-digest-metadata-{subjectId}",
                resolved.CorrelationId,
                new MetadataWriteOperationPayload(
                    $"research-digest-metadata-{subjectId}",
                    "research-digest",
                    subjectId,
                    new SchemaRef("schema://research/digest@1"),
                    extracted.StructuredJson,
                    "scheduled research digest",
                    CapabilityId: RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "research-metadata")));
            return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(state), [digestIntent], "research_digest_generated");
        }

        var intents = new List<RoleOperation>
        {
            RoleBehaviorSupport.MetadataWrite($"research-summary-{subjectId}", resolved.CorrelationId, new MetadataWriteOperationPayload($"research-summary-{subjectId}", "research-document", subjectId, extracted.SchemaRef, extracted.StructuredJson, "research extraction", CapabilityId: RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "research-metadata"))),
            RoleBehaviorSupport.Schedule($"research-digest-{subjectId}", resolved.CorrelationId, new ScheduledWorkOperationPayload(
                $"research-digest-{subjectId}",
                $"schedule-research-{subjectId}",
                new ActorAddress($"agent/{context.RoleAgentId.Value}", "local"),
                "research.run_digest",
                JsonSerializer.Serialize(new ResearchDigestCommand(sourceArtifactForDigest, subjectId, topic, dueAt, $"Weekly research digest for {topic}")),
                dueAt,
                resolved.CorrelationId,
                $"Weekly research digest for {topic}",
                RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "research-schedule"),
                Recurrence: TimeSpan.FromDays(7).ToString()))
        };
        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(state), intents, "research_summary_recorded");
    }

    private static RoleBehaviorResult ApplyCompletion(OperationResolved resolved, RoleBehaviorContext context)
    {
        var state = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ResearchWatchRoleState.Empty);
        var remainingOutstanding = context.OutstandingOperations.Where(intent => !(intent.RequestId == resolved.Key.RequestId.Value && intent.TargetOperationType == resolved.Key.OperationType)).ToArray();
        if (resolved.Key.OperationType == ResourceOperationTypes.ScheduleCreate)
        {
            using var document = JsonDocument.Parse(resolved.Value.ValueJson);
            if (document.RootElement.TryGetProperty("scheduleId", out var scheduleId) && scheduleId.GetString() is { Length: > 0 } id)
            {
                state = state with { DigestScheduleIds = state.DigestScheduleIds.Concat([id]).ToArray() };
            }
        }

        var finalResult = resolved.Key.RequestId.Value.Contains("research-digest-metadata-", StringComparison.OrdinalIgnoreCase)
            ? "research_digest_generated"
            : state.DigestScheduleIds.Count > 0 ? "digest_scheduled" : "research_summary_recorded";
        return new RoleBehaviorResult(remainingOutstanding.Length == 0 ? RoleBehaviorStatus.Idle : RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(state), Array.Empty<RoleOperation>(), remainingOutstanding.Length == 0 ? finalResult : "research_summary_recorded");
    }

    private static ResearchWatchExtractedDocument ParseResearchExtraction(string json, string requestId)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("structuredJson", out var structuredProperty))
        {
            var structuredJson = structuredProperty.ValueKind == JsonValueKind.String ? structuredProperty.GetString()! : structuredProperty.GetRawText();
            return new ResearchWatchExtractedDocument(ParseArtifactRef(root, requestId), requestId.Contains("digest", StringComparison.OrdinalIgnoreCase) ? new SchemaRef("schema://research/digest@1") : new SchemaRef("schema://research/document-summary@1"), structuredJson);
        }

        return new ResearchWatchExtractedDocument(new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(requestId)), new SchemaRef("schema://research/document-summary@1"), root.GetRawText());
    }

    private static ToolkitArtifactRef ParseArtifactRef(JsonElement root, string fallbackArtifactId)
    {
        var artifactId = root.TryGetProperty("artifactId", out var artifactIdProperty) && artifactIdProperty.ValueKind == JsonValueKind.String
            ? artifactIdProperty.GetString()
            : fallbackArtifactId;
        var revisionId = root.TryGetProperty("revisionId", out var revisionIdProperty) && revisionIdProperty.ValueKind == JsonValueKind.String
            ? revisionIdProperty.GetString()
            : null;
        return new ToolkitArtifactRef(
            new Aven.Toolkit.Core.Identifiers.ArtifactId(artifactId ?? fallbackArtifactId),
            revisionId is null ? null : new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId(revisionId));
    }
}
