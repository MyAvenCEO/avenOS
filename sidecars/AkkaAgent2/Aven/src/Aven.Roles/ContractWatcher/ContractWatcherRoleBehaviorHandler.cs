using System.Text.Json;
using ToolkitArtifactRef = Aven.Toolkit.Artifacts.ArtifactRef;

namespace Aven.Roles.ContractWatcher;

internal sealed class ContractWatcherRoleBehaviorHandler : IRoleBehaviorHandler
{
    public string? CreateInitialStateJson() => JsonSerializer.Serialize(ContractWatcherRoleState.Empty);

    public bool CanHandle(OperationResolved resolved, RoleBehaviorContext context)
    {
        if (resolved.Key.OperationType is "contracts.ingest_document" or "contracts.reminder_due")
        {
            return true;
        }

        var watcher = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ContractWatcherRoleState.Empty);
        var active = watcher.ReceivedDocuments.Count > 0 || watcher.LatestContract is not null || watcher.ReminderIds.Count > 0;
        return active && resolved.Key.OperationType is ResourceOperationTypes.LlmGenerate or ResourceOperationTypes.MetadataCreate or ResourceOperationTypes.ScheduleCreate;
    }

    public RoleBehaviorResult Apply(OperationResolved resolved, RoleBehaviorContext context) => resolved.Key.OperationType switch
    {
        "contracts.ingest_document" => ApplyIngest(RoleBehaviorSupport.Deserialize<ContractWatcherDocumentCommand>(resolved.Value.ValueJson, "Contract watcher intake command was empty."), context),
        "contracts.reminder_due" => ApplyReminderDue(resolved, context),
        ResourceOperationTypes.LlmGenerate => ApplyExtraction(resolved, context),
        ResourceOperationTypes.MetadataCreate or ResourceOperationTypes.ScheduleCreate => ApplySideEffectCompletion(resolved, context),
        _ => new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, context.RoleStateJson, Array.Empty<RoleOperation>(), null)
    };

    public object CreateCommittedCommand(string expectedCommandType, RoleCommittedInput input) =>
        expectedCommandType switch
        {
            "contracts.reminder_due" => new ContractReminderDueCommand(
                input.IncomingItemRef,
                input.ContentSummary,
                DateTimeOffset.UtcNow,
                input.ProposedReason),
            _ => new ContractWatcherDocumentCommand(
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

    private static RoleBehaviorResult ApplyIngest(ContractWatcherDocumentCommand command, RoleBehaviorContext context)
    {
        var watcher = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ContractWatcherRoleState.Empty);
        watcher = watcher with { ReceivedDocuments = watcher.ReceivedDocuments.Concat([command]).ToArray() };
        var requestId = $"contract-extract-{command.ClaimId.Value}";
        var plan = new LlmGenerateOperationPayload(
            requestId,
            new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(command.IncomingItemRef)),
            new SchemaRef("schema://contracts/contract-summary@1"),
            $"Extract strict contract summary JSON with obligations and renewal terms from {command.IncomingItemRef}.",
            "contracts.extract",
            RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "llm-contract"));
        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(watcher), [RoleBehaviorSupport.LlmExtraction(requestId, command.CorrelationId, plan)], null);
    }

    private static RoleBehaviorResult ApplyReminderDue(OperationResolved resolved, RoleBehaviorContext context)
    {
        var command = RoleBehaviorSupport.Deserialize<ContractReminderDueCommand>(resolved.Value.ValueJson, "Contract reminder command was empty.");
        var watcher = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ContractWatcherRoleState.Empty);
        var requestId = $"contract-reminder-fired-{command.ContractId}-{command.DueAt.UtcTicks}";
        var metadataPlan = new MetadataWriteOperationPayload(
            requestId,
            "contract-reminder",
            command.ContractId,
            new SchemaRef("schema://contracts/reminder-fired@1"),
            JsonSerializer.Serialize(new
            {
                contractId = command.ContractId,
                reminderText = command.ReminderText,
                dueAt = command.DueAt,
                summary = command.Summary
            }),
            "scheduled contract reminder",
            CapabilityId: RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "contract-reminder-fired"));
        return new RoleBehaviorResult(
            RoleBehaviorStatus.WaitingForOperation,
            JsonSerializer.Serialize(watcher),
            [RoleBehaviorSupport.MetadataWrite(requestId, resolved.CorrelationId, metadataPlan)],
            "reminder_due_processing");
    }

    private static RoleBehaviorResult ApplyExtraction(OperationResolved resolved, RoleBehaviorContext context)
    {
        var watcher = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ContractWatcherRoleState.Empty);
        var extracted = ParseContractExtraction(resolved.Value.ValueJson, resolved.Key.RequestId.Value);
        watcher = watcher with { LatestContract = extracted, LatestSummaryJson = extracted.StructuredJson };
        var deliveries = BuildContractSideEffects(extracted, context.RoleAgentId, resolved.CorrelationId);
        return new RoleBehaviorResult(
            RoleBehaviorStatus.WaitingForOperation,
            JsonSerializer.Serialize(watcher),
            deliveries,
            deliveries.Any(x => x.TargetOperationType == ResourceOperationTypes.ScheduleCreate) ? "contract_recorded_pending_reminder" : "contract_recorded");
    }

    private static RoleBehaviorResult ApplySideEffectCompletion(OperationResolved resolved, RoleBehaviorContext context)
    {
        var watcher = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, ContractWatcherRoleState.Empty);
        var remainingOutstanding = context.OutstandingOperations.Where(intent => !(intent.RequestId == resolved.Key.RequestId.Value && intent.TargetOperationType == resolved.Key.OperationType)).ToArray();
        var hasSchedulePending = remainingOutstanding.Any(intent => intent.TargetOperationType == ResourceOperationTypes.ScheduleCreate);
        if (StringComparer.Ordinal.Equals(resolved.Key.OperationType, ResourceOperationTypes.MetadataCreate))
        {
            var status = hasSchedulePending ? RoleBehaviorStatus.WaitingForOperation : RoleBehaviorStatus.Idle;
            var metadataResult = hasSchedulePending ? "contract_recorded_pending_reminder" : (watcher.ReminderIds.Count > 0 ? "reminder_scheduled" : "contract_recorded");
            return new RoleBehaviorResult(status, JsonSerializer.Serialize(watcher), Array.Empty<RoleOperation>(), metadataResult);
        }

        if (StringComparer.Ordinal.Equals(resolved.Key.OperationType, ResourceOperationTypes.ScheduleCreate))
        {
            var reminderIds = watcher.ReminderIds.ToList();
            using var document = JsonDocument.Parse(resolved.Value.ValueJson);
            if (document.RootElement.TryGetProperty("scheduleId", out var scheduleId) && scheduleId.GetString() is { Length: > 0 } id)
            {
                reminderIds.Add(id);
            }

            watcher = watcher with { ReminderIds = reminderIds };
        }

        var finalResult = watcher.ReminderIds.Count > 0 ? "reminder_scheduled" : "contract_recorded";
        return new RoleBehaviorResult(remainingOutstanding.Length == 0 ? RoleBehaviorStatus.Idle : RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(watcher), Array.Empty<RoleOperation>(), remainingOutstanding.Length == 0 ? finalResult : "contract_recorded_pending_reminder");
    }

    private static ContractWatcherExtractedDocument ParseContractExtraction(string json, string requestId)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("structuredJson", out var structuredProperty))
        {
            var structuredJson = structuredProperty.ValueKind == JsonValueKind.String ? structuredProperty.GetString()! : structuredProperty.GetRawText();
            return new ContractWatcherExtractedDocument(ParseArtifactRef(root, requestId), new SchemaRef("schema://contracts/contract-summary@1"), structuredJson);
        }

        return new ContractWatcherExtractedDocument(new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(requestId)), new SchemaRef("schema://contracts/contract-summary@1"), root.GetRawText());
    }

    private static List<RoleOperation> BuildContractSideEffects(ContractWatcherExtractedDocument document, RoleAgentId agentId, CorrelationId correlationId)
    {
        using var parsed = JsonDocument.Parse(document.StructuredJson);
        var root = parsed.RootElement;
        var contractId = root.TryGetProperty("contractId", out var contractIdProperty) ? contractIdProperty.GetString() ?? "CONTRACT-UNKNOWN" : "CONTRACT-UNKNOWN";
        var reminderText = root.TryGetProperty("reminderText", out var reminderTextProperty) ? reminderTextProperty.GetString() ?? $"Review contract {contractId}" : $"Review contract {contractId}";
        var dueAt = root.TryGetProperty("renewalDate", out var renewalDateProperty) && renewalDateProperty.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(renewalDateProperty.GetString(), out var parsedDueAt)
            ? parsedDueAt
            : DateTimeOffset.UtcNow.AddDays(30);

        var intents = new List<RoleOperation>
        {
            RoleBehaviorSupport.MetadataWrite($"contract-summary-{contractId}", correlationId, new MetadataWriteOperationPayload($"contract-summary-{contractId}", "contract", contractId, new SchemaRef("schema://contracts/contract-summary@1"), document.StructuredJson, "contract extraction", ArtifactId: new ArtifactId(contractId), CapabilityId: RoleCapabilityIds.ForRoleAgent(agentId, "contract-summary")))
        };

        if (root.TryGetProperty("renewalTermJson", out var renewalTermJsonProperty))
        {
            var renewalTermJson = renewalTermJsonProperty.ValueKind == JsonValueKind.String ? renewalTermJsonProperty.GetString()! : renewalTermJsonProperty.GetRawText();
            intents.Add(RoleBehaviorSupport.MetadataWrite($"contract-renewal-{contractId}", correlationId, new MetadataWriteOperationPayload($"contract-renewal-{contractId}", "contract-renewal", contractId, new SchemaRef("schema://contracts/renewal-term@1"), renewalTermJson, "renewal extraction", CapabilityId: RoleCapabilityIds.ForRoleAgent(agentId, "contract-renewal"))));
        }

        intents.Add(RoleBehaviorSupport.Schedule($"contract-reminder-{contractId}", correlationId, new ScheduledWorkOperationPayload(
            $"contract-reminder-{contractId}",
            $"schedule-contract-{contractId}",
            new ActorAddress($"agent/{agentId.Value}", "local"),
            "contracts.reminder_due",
            JsonSerializer.Serialize(new ContractReminderDueCommand(contractId, reminderText, dueAt, $"Reminder for contract {contractId}")),
            dueAt,
            correlationId,
            reminderText,
            RoleCapabilityIds.ForRoleAgent(agentId, "contract-reminder"))));
        return intents;
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
