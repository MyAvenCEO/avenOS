using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Aven.Roles.Accounting.Extraction;
using Aven.Roles.Accounting.Matching;
using Aven.Roles.Accounting.Metadata;
using Aven.Roles.Accounting.Normalization;
using Aven.Roles.Accounting.Schemas;
using ToolkitArtifactRef = Aven.Toolkit.Artifacts.ArtifactRef;

namespace Aven.Roles.Accounting;

internal sealed class AccountingRoleBehaviorHandler : IRoleBehaviorHandler
{
    public string? CreateInitialStateJson() => JsonSerializer.Serialize(AccountingRoleState.Empty);

    public bool CanHandle(OperationResolved resolved, RoleBehaviorContext context)
    {
        if (IsIngestCommand(resolved.Key.OperationType))
        {
            return true;
        }

        // RoleAgentActor removes the completed operation from its pending map before asking the role
        // to advance. If the actor routed an operation reply here, it has already proven the operation
        // was pending for this run; Apply(...) validates the request id against accountant workflow refs.
        return resolved.Key.OperationType is ResourceOperationTypes.LlmGenerate
            or ResourceOperationTypes.MetadataCreate
            or ResourceOperationTypes.MetadataQuery
            or ResourceOperationTypes.HumanApprove;
    }

    public RoleBehaviorResult Apply(OperationResolved resolved, RoleBehaviorContext context) => resolved.Key.OperationType switch
    {
        var operationType when IsIngestCommand(operationType) => ApplyIngest(RoleBehaviorSupport.Deserialize<AccountingDocumentCommand>(resolved.Value.ValueJson, "Accounting intake command was empty."), context),
        ResourceOperationTypes.LlmGenerate => ApplyExtraction(resolved, context),
        ResourceOperationTypes.MetadataCreate => ApplyMetadataWriteCompletion(resolved, context),
        ResourceOperationTypes.MetadataQuery => ApplyMetadataQuery(resolved, context),
        ResourceOperationTypes.HumanApprove => ApplyHumanReview(resolved, context),
        _ => new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, context.RoleStateJson, Array.Empty<RoleOperation>(), null)
    };

    public object CreateCommittedCommand(string expectedCommandType, RoleCommittedInput input) =>
        new AccountingDocumentCommand(
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
            input.ReplyTo);

    private static RoleBehaviorResult ApplyIngest(AccountingDocumentCommand command, RoleBehaviorContext context)
    {
        var accountant = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, AccountingRoleState.Empty);
        var sourceArtifact = ResolveSourceArtifact(command);
        var classification = AccountingDocumentClassifier.ClassifyDeterministically(command);
        var pending = new AccountingPendingIngestion(
            command.ClaimId.Value,
            sourceArtifact.ArtifactId.Value,
            sourceArtifact.RevisionId?.Value,
            command.CorrelationId.Value,
            classification == AccountingDocumentTarget.Unknown ? null : ResolveDocumentKind(classification));
        accountant = accountant with
        {
            PendingIngestions = accountant.PendingIngestions.Concat([pending]).ToArray(),
            LastResult = null
        };

        var operation = classification == AccountingDocumentTarget.Unknown
            ? CreateClassificationOperation(command, context.RoleAgentId, sourceArtifact)
            : CreateExtractionOperation(command, context.RoleAgentId, sourceArtifact, classification);

        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), [operation], null);
    }

    private static RoleBehaviorResult ApplyExtraction(OperationResolved resolved, RoleBehaviorContext context)
    {
        var accountant = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, AccountingRoleState.Empty);
        if (resolved.Key.RequestId.Value.StartsWith("accounting-classify-", StringComparison.Ordinal))
        {
            var target = ParseClassificationTarget(resolved.Value.ValueJson);
            var ingestion = ResolvePendingIngestionForRequest(accountant, resolved.Key.RequestId.Value);
            if (ingestion is null)
            {
                return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), Array.Empty<RoleOperation>(), accountant.LastResult);
            }

            if (target == AccountingDocumentTarget.Unsupported)
            {
                accountant = accountant with
                {
                    PendingIngestions = accountant.PendingIngestions.Where(x => !string.Equals(x.ClaimId, ingestion.ClaimId, StringComparison.Ordinal)).ToArray(),
                    LastResult = "unsupported_document"
                };
                return new RoleBehaviorResult(RoleBehaviorStatus.Idle, JsonSerializer.Serialize(accountant), Array.Empty<RoleOperation>(), "unsupported_document");
            }

            if (target == AccountingDocumentTarget.Unknown)
            {
                accountant = accountant with
                {
                    PendingIngestions = accountant.PendingIngestions.Where(x => !string.Equals(x.ClaimId, ingestion.ClaimId, StringComparison.Ordinal)).ToArray(),
                    LastResult = "document_classification_failed"
                };
                return new RoleBehaviorResult(RoleBehaviorStatus.Blocked, JsonSerializer.Serialize(accountant), Array.Empty<RoleOperation>(), "document_classification_failed");
            }

            var sourceArtifact = ParseArtifactRefFromLlmResult(resolved.Value.ValueJson, ingestion);
            var updatedIngestion = ingestion with { ClassifiedDocumentKind = ResolveDocumentKind(target) };
            accountant = accountant with
            {
                PendingIngestions = accountant.PendingIngestions.Select(x => string.Equals(x.ClaimId, ingestion.ClaimId, StringComparison.Ordinal) ? updatedIngestion : x).ToArray()
            };
            var command = CreateSyntheticCommand(context.RoleAgentId, updatedIngestion);
            var extraction = CreateExtractionOperation(command, context.RoleAgentId, sourceArtifact, target);
            return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), [extraction], null);
        }

        var extracted = ParseAccountingExtractionResult(resolved.Value.ValueJson, resolved.Key.RequestId.Value);
        var pendingIngestion = ResolvePendingIngestionForRequest(accountant, resolved.Key.RequestId.Value);
        if (pendingIngestion is null)
        {
            return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), Array.Empty<RoleOperation>(), accountant.LastResult);
        }

        accountant = accountant with
        {
            PendingIngestions = accountant.PendingIngestions.Where(x => !string.Equals(x.ClaimId, pendingIngestion.ClaimId, StringComparison.Ordinal)).ToArray()
        };

        var canonicalJson = extracted.DocumentKind == "statement"
            ? AccountingValueNormalizer.NormalizeStatement(extracted.StructuredJson, AccountingSchemaRefs.AccountStatementExtractionV1.Value)
            : AccountingValueNormalizer.NormalizeInvoice(extracted.StructuredJson, AccountingSchemaRefs.InvoiceExtractionV1.Value);
        var canonical = extracted with
        {
            StructuredJson = canonicalJson,
            SchemaRef = extracted.DocumentKind == "statement" ? AccountingSchemaRefs.AccountStatementV3 : AccountingSchemaRefs.InvoiceV3
        };

        var operations = canonical.DocumentKind == "statement"
            ? AccountingMetadataWritePlanner.BuildStatementOperations(canonical, context.RoleAgentId, resolved.CorrelationId).ToArray()
            : AccountingMetadataWritePlanner.BuildInvoiceOperations(canonical, context.RoleAgentId, resolved.CorrelationId).ToArray();

        var subjectId = canonical.DocumentKind == "statement"
            ? AccountingSubjectIds.StatementSubjectId(canonical.StructuredJson, canonical.SourceArtifact)
            : AccountingSubjectIds.InvoiceSubjectId(canonical.StructuredJson, canonical.SourceArtifact);
        var pendingStores = operations
            .Where(static operation => string.Equals(operation.TargetOperationType, ResourceOperationTypes.MetadataCreate, StringComparison.Ordinal))
            .Select(operation =>
            {
                var payload = RoleBehaviorSupport.Deserialize<MetadataWriteOperationPayload>(operation.Payload.Json, "Accounting metadata operation payload was empty.");
                return new AccountingPendingDocumentStorage(
                    payload.RequestId,
                    extracted.DocumentKind,
                    payload.SubjectId,
                    subjectId,
                    payload.SchemaRef.Value,
                    extracted.SourceArtifact.ArtifactId.Value,
                    extracted.SourceArtifact.RevisionId?.Value);
            })
            .ToArray();

        accountant = accountant with
        {
            PendingDocumentStores = accountant.PendingDocumentStores.Concat(pendingStores).ToArray(),
            Facts = MergeFacts(accountant.Facts, BuildFactsFromExtraction(canonical, subjectId)),
            LastResult = extracted.DocumentKind == "statement" ? "statement_recorded" : "invoice_recorded"
        };

        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), operations, accountant.LastResult);
    }

    private static RoleBehaviorResult ApplyMetadataWriteCompletion(OperationResolved resolved, RoleBehaviorContext context)
    {
        var accountant = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, AccountingRoleState.Empty);
        var completedStore = accountant.PendingDocumentStores.FirstOrDefault(x => string.Equals(x.MetadataRequestId, resolved.Key.RequestId.Value, StringComparison.Ordinal));
        var operations = new List<RoleOperation>();
        if (completedStore is not null)
        {
            var remainingDocumentStores = accountant.PendingDocumentStores
                .Where(x => !string.Equals(x.MetadataRequestId, completedStore.MetadataRequestId, StringComparison.Ordinal))
                .ToArray();
            accountant = accountant with
            {
                PendingDocumentStores = remainingDocumentStores
            };

            var documentStoresStillPending = remainingDocumentStores.Any(x =>
                string.Equals(x.DocumentKind, completedStore.DocumentKind, StringComparison.Ordinal)
                && string.Equals(x.DocumentSubjectId, completedStore.DocumentSubjectId, StringComparison.Ordinal)
                && string.Equals(x.SourceArtifactId, completedStore.SourceArtifactId, StringComparison.Ordinal));
            if (!documentStoresStillPending)
            {
                var queryRequestId = $"accounting-match-refresh-{ShortHash(completedStore.DocumentKind, completedStore.DocumentSubjectId)}";
                if (!accountant.PendingMatchRefreshes.Any(x => string.Equals(x.QueryRequestId, queryRequestId, StringComparison.Ordinal)))
                {
                    accountant = accountant with
                    {
                        PendingMatchRefreshes = accountant.PendingMatchRefreshes.Concat([
                            new AccountingPendingMatchRefresh(queryRequestId, completedStore.DocumentKind, completedStore.DocumentSubjectId)
                        ]).ToArray()
                    };
                    operations.Add(CreateMatchRefreshOperation(queryRequestId, context.RoleAgentId, resolved.CorrelationId));
                }
            }
        }

        return BuildCompletionResult(accountant, context, resolved.Key, operations, accountant.LastResult);
    }

    private static RoleBehaviorResult ApplyMetadataQuery(OperationResolved resolved, RoleBehaviorContext context)
    {
        var accountant = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, AccountingRoleState.Empty);
        var refresh = accountant.PendingMatchRefreshes.FirstOrDefault(x => string.Equals(x.QueryRequestId, resolved.Key.RequestId.Value, StringComparison.Ordinal));
        accountant = accountant with
        {
            PendingMatchRefreshes = accountant.PendingMatchRefreshes.Where(x => !string.Equals(x.QueryRequestId, resolved.Key.RequestId.Value, StringComparison.Ordinal)).ToArray()
        };

        var queryResult = RoleBehaviorSupport.Deserialize<MetadataQueryOperationResult>(resolved.Value.ValueJson, "Metadata query result was empty.");
        var plan = AccountingMetadataMatchPlanner.BuildPlan(
            queryResult,
            refresh?.TriggerDocumentKind ?? "invoice",
            refresh?.TriggerSubjectId ?? string.Empty,
            context.RoleAgentId,
            resolved.CorrelationId,
            accountant.PendingHumanReviews);
        accountant = accountant with
        {
            Facts = ApplyFactUpdatesFromPlannedOperations(accountant.Facts, plan.Operations),
            PendingHumanReviews = accountant.PendingHumanReviews.Concat(plan.PendingHumanReviews).ToArray(),
            LastResult = plan.LastResult
        };

        if (plan.Operations.Count > 0)
        {
            return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), plan.Operations, plan.LastResult);
        }

        return BuildCompletionResult(accountant, context, resolved.Key, Array.Empty<RoleOperation>(), plan.LastResult);
    }

    private static RoleBehaviorResult ApplyHumanReview(OperationResolved resolved, RoleBehaviorContext context)
    {
        var accountant = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, AccountingRoleState.Empty);
        var pendingReview = accountant.PendingHumanReviews.FirstOrDefault(x => string.Equals(x.PromptRequestId, resolved.Key.RequestId.Value, StringComparison.Ordinal));
        if (pendingReview is null)
        {
            return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), Array.Empty<RoleOperation>(), accountant.LastResult);
        }

        var answer = ParseHumanAnswer(resolved.Value.ValueJson);
        var paymentJson = string.Equals(answer, "approve", StringComparison.OrdinalIgnoreCase)
            ? pendingReview.ApprovedPaymentMatchJson
            : pendingReview.RejectedPaymentMatchJson;
        using var document = JsonDocument.Parse(paymentJson);
        var matchId = document.RootElement.TryGetProperty("match_id", out var matchIdProperty) && matchIdProperty.ValueKind == JsonValueKind.String
            ? matchIdProperty.GetString() ?? pendingReview.MatchSubjectId
            : pendingReview.MatchSubjectId;
        var requestId = $"payment-match-review-{ShortHash(paymentJson)}";
        var status = document.RootElement.TryGetProperty("status", out var statusProperty) && statusProperty.ValueKind == JsonValueKind.String
            ? statusProperty.GetString() ?? accountant.LastResult ?? "unknown"
            : accountant.LastResult ?? "unknown";

        accountant = accountant with
        {
            Facts = ApplyFactUpdatesFromPaymentJson(accountant.Facts, paymentJson, status),
            PendingHumanReviews = accountant.PendingHumanReviews.Where(x => !string.Equals(x.PromptRequestId, pendingReview.PromptRequestId, StringComparison.Ordinal)).ToArray(),
            LastResult = status
        };

        var operations = new[]
        {
            RoleBehaviorSupport.MetadataWrite(
                requestId,
                resolved.CorrelationId,
                new MetadataWriteOperationPayload(
                    requestId,
                    AccountingMetadataSubjects.PaymentMatch,
                    matchId,
                    AccountingSchemaRefs.PaymentMatchV3,
                    paymentJson,
                    $"human review {answer}",
                    CapabilityId: RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "payment-match-metadata")))
        };
        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), operations, status);
    }

    private static RoleBehaviorResult BuildCompletionResult(AccountingRoleState accountant, RoleBehaviorContext context, OperationKey processedKey, IReadOnlyList<RoleOperation> newOperations, string? finalResult)
    {
        if (newOperations.Count > 0)
        {
            return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(accountant), newOperations, finalResult);
        }

        var remainingOutstanding = context.OutstandingOperations.Where(intent => !(intent.RequestId == processedKey.RequestId.Value && intent.TargetOperationType == processedKey.OperationType)).ToArray();
        var remainingNonHuman = remainingOutstanding.Where(static x => x.TargetOperationType != ResourceOperationTypes.HumanApprove).ToArray();
        var status = accountant.PendingHumanReviews.Count > 0 && remainingNonHuman.Length == 0
            ? RoleBehaviorStatus.WaitingForHuman
            : remainingOutstanding.Length == 0
                ? RoleBehaviorStatus.Idle
                : RoleBehaviorStatus.WaitingForOperation;
        return new RoleBehaviorResult(status, JsonSerializer.Serialize(accountant), Array.Empty<RoleOperation>(), status == RoleBehaviorStatus.Idle || status == RoleBehaviorStatus.WaitingForHuman ? finalResult ?? accountant.LastResult : null);
    }

    private static RoleOperation CreateMatchRefreshOperation(string requestId, RoleAgentId roleAgentId, CorrelationId correlationId)
        => RoleBehaviorSupport.MetadataQuery(
            requestId,
            correlationId,
            new MetadataQueryOperationPayload(
                RequestId: requestId,
                SubjectKinds: [AccountingMetadataSubjects.Invoice, AccountingMetadataSubjects.AccountStatement, AccountingMetadataSubjects.StatementTransaction, AccountingMetadataSubjects.PaymentMatch],
                SchemaRefs: [AccountingSchemaRefs.InvoiceV3, AccountingSchemaRefs.AccountStatementV3, AccountingSchemaRefs.StatementTransactionV3, AccountingSchemaRefs.PaymentMatchV3],
                Limit: 200,
                TimeoutMilliseconds: 1000,
                CapabilityId: RoleCapabilityIds.ForRoleAgent(roleAgentId, "metadata-query")));

    private static RoleOperation CreateClassificationOperation(AccountingDocumentCommand command, RoleAgentId roleAgentId, ToolkitArtifactRef sourceArtifact)
    {
        var requestId = $"accounting-classify-{command.ClaimId.Value}-{sourceArtifact.ArtifactId.Value}";
        return RoleBehaviorSupport.LlmExtraction(
            requestId,
            command.CorrelationId,
            new LlmGenerateOperationPayload(
                requestId,
                sourceArtifact,
                AccountingSchemaRefs.DocumentClassificationV1,
                AccountingExtractionPrompts.BuildClassificationPrompt(),
                AccountingDocumentClassifier.ResolvePurpose(AccountingDocumentTarget.Unknown),
                RoleCapabilityIds.ForRoleAgent(roleAgentId, "llm-extract")));
    }

    private static RoleOperation CreateExtractionOperation(AccountingDocumentCommand command, RoleAgentId roleAgentId, ToolkitArtifactRef sourceArtifact, AccountingDocumentTarget target)
    {
        var requestId = target == AccountingDocumentTarget.Statement
            ? $"statement-extract-{command.ClaimId.Value}"
            : $"invoice-extract-{command.ClaimId.Value}";
        var schemaRef = AccountingDocumentClassifier.ResolveSchemaRef(target);
        return RoleBehaviorSupport.LlmExtraction(
            requestId,
            command.CorrelationId,
            new LlmGenerateOperationPayload(
                requestId,
                sourceArtifact,
                schemaRef,
                AccountingExtractionPrompts.BuildExtractionPrompt(schemaRef),
                AccountingDocumentClassifier.ResolvePurpose(target),
                RoleCapabilityIds.ForRoleAgent(roleAgentId, "llm-extract")));
    }

    private static AccountingExtractedDocument ParseAccountingExtractionResult(string json, string requestId)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var kind = InferAccountingDocumentKind(requestId);
        var structuredJson = root.ValueKind == JsonValueKind.Object && root.TryGetProperty("structuredJson", out var structuredProperty)
            ? structuredProperty.ValueKind == JsonValueKind.String ? structuredProperty.GetString()! : structuredProperty.GetRawText()
            : root.GetRawText();
        var artifactRef = root.ValueKind == JsonValueKind.Object
            ? ParseArtifactRef(root, requestId)
            : new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(requestId));
        return new AccountingExtractedDocument(kind, artifactRef, kind == "statement" ? AccountingSchemaRefs.AccountStatementExtractionV1 : AccountingSchemaRefs.InvoiceExtractionV1, structuredJson);
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

    private static ToolkitArtifactRef ResolveSourceArtifact(AccountingDocumentCommand command)
    {
        var artifactId = command.AttachmentRefs.FirstOrDefault(static x => !string.IsNullOrWhiteSpace(x)) ?? command.IncomingItemRef;
        return new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(artifactId));
    }

    private static ToolkitArtifactRef ParseArtifactRefFromLlmResult(string json, AccountingPendingIngestion ingestion)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.ValueKind == JsonValueKind.Object
            ? ParseArtifactRef(document.RootElement, ingestion.SourceArtifactId)
            : new ToolkitArtifactRef(new Aven.Toolkit.Core.Identifiers.ArtifactId(ingestion.SourceArtifactId), ingestion.SourceArtifactRevisionId is null ? null : new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId(ingestion.SourceArtifactRevisionId));
    }

    private static AccountingPendingIngestion? ResolvePendingIngestionForRequest(AccountingRoleState accountant, string requestId)
        => accountant.PendingIngestions.LastOrDefault(ingestion => requestId.Contains(ingestion.ClaimId, StringComparison.Ordinal));

    private static AccountingDocumentTarget ParseClassificationTarget(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        JsonDocument? structuredDocument = null;
        try
        {
            var structured = root;
            if (root.TryGetProperty("structuredJson", out var structuredProperty))
            {
                if (structuredProperty.ValueKind == JsonValueKind.String)
                {
                    structuredDocument = JsonDocument.Parse(structuredProperty.GetString() ?? "{}");
                    structured = structuredDocument.RootElement;
                }
                else
                {
                    structured = structuredProperty;
                }
            }

            var documentKind = structured.TryGetProperty("document_kind", out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;
            return documentKind switch
            {
                "account_statement" => AccountingDocumentTarget.Statement,
                "invoice_like" => AccountingDocumentTarget.Invoice,
                "unsupported" => AccountingDocumentTarget.Unsupported,
                _ => AccountingDocumentTarget.Unknown
            };
        }
        finally
        {
            structuredDocument?.Dispose();
        }
    }

    private static string InferAccountingDocumentKind(string requestId) =>
        requestId.StartsWith("statement-extract-", StringComparison.OrdinalIgnoreCase)
        || requestId.StartsWith("accounting-classify-statement-", StringComparison.OrdinalIgnoreCase)
            ? "statement"
            : "invoice";


    private static bool IsIngestCommand(string operationType) =>
        string.Equals(operationType, AccountingOperationTypes.IngestDocument, StringComparison.Ordinal)
        || string.Equals(operationType, AccountingOperationTypes.Invoice, StringComparison.Ordinal)
        || string.Equals(operationType, AccountingOperationTypes.Statement, StringComparison.Ordinal)
        || string.Equals(operationType, AccountingOperationTypes.AccountStatement, StringComparison.Ordinal);

    private static string ResolveDocumentKind(AccountingDocumentTarget target)
        => target == AccountingDocumentTarget.Statement ? "statement" : "invoice";

    private static AccountingDocumentCommand CreateSyntheticCommand(RoleAgentId roleAgentId, AccountingPendingIngestion ingestion)
        => new(
            new RoutingAttemptId($"route-{ingestion.ClaimId}"),
            new WorkOfferId($"offer-{ingestion.ClaimId}"),
            new WorkClaimId(ingestion.ClaimId),
            roleAgentId,
            ingestion.SourceArtifactId,
            [ingestion.SourceArtifactId],
            "accounting document",
            ingestion.ClassifiedDocumentKind == "statement" ? AccountingOperationTypes.Statement : AccountingOperationTypes.Invoice,
            "synthetic follow-up command",
            ingestion.ClassifiedDocumentKind == "statement"
                ? [AccountingSchemaRefs.AccountStatementV3]
                : [AccountingSchemaRefs.InvoiceV3],
            new CorrelationId(ingestion.CorrelationId),
            new ActorAddress("router/a", "local"));

    private static string ParseHumanAnswer(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.TryGetProperty("answer", out var answer) && answer.ValueKind == JsonValueKind.String)
        {
            return answer.GetString() ?? "reject";
        }

        return json.Contains("approve", StringComparison.OrdinalIgnoreCase) ? "approve" : "reject";
    }

    private static IReadOnlyList<AccountingMemoryFact> BuildFactsFromExtraction(AccountingExtractedDocument extracted, string subjectId)
    {
        using var document = JsonDocument.Parse(extracted.StructuredJson);
        var root = document.RootElement;
        if (string.Equals(extracted.DocumentKind, "statement", StringComparison.Ordinal))
        {
            return
            [
                new AccountingMemoryFact(
                    "statement",
                    subjectId,
                    ReadString(root, "account_iban") ?? subjectId,
                    "statement_recorded")
            ];
        }

        var invoiceReference = ReadString(root, "invoice_number") ?? subjectId;
        return
        [
            new AccountingMemoryFact("invoice", subjectId, invoiceReference, "invoice_recorded")
        ];
    }

    private static IReadOnlyList<AccountingMemoryFact> ApplyFactUpdatesFromPlannedOperations(
        IReadOnlyList<AccountingMemoryFact> existing,
        IReadOnlyList<RoleOperation> operations)
    {
        var facts = existing.ToDictionary(static x => x.SubjectId, StringComparer.Ordinal);
        foreach (var operation in operations.Where(static x => string.Equals(x.TargetOperationType, ResourceOperationTypes.MetadataCreate, StringComparison.Ordinal)))
        {
            var payload = RoleBehaviorSupport.Deserialize<MetadataWriteOperationPayload>(operation.Payload.Json, "Accounting metadata operation payload was empty.");
            if (!string.Equals(payload.SchemaRef.Value, AccountingSchemaRefs.PaymentMatchV3.Value, StringComparison.Ordinal))
            {
                continue;
            }

            using var document = JsonDocument.Parse(payload.Json);
            var root = document.RootElement;
            var invoiceSubjectId = ReadString(root, "invoice_subject_id");
            if (string.IsNullOrWhiteSpace(invoiceSubjectId))
            {
                continue;
            }

            var reference = ReadString(root, "invoice_number") ?? invoiceSubjectId;
            var status = ReadString(root, "status");
            facts[invoiceSubjectId] = new AccountingMemoryFact("invoice", invoiceSubjectId, reference, status);
        }

        return facts.Values.ToArray();
    }

    private static IReadOnlyList<AccountingMemoryFact> ApplyFactUpdatesFromPaymentJson(
        IReadOnlyList<AccountingMemoryFact> existing,
        string paymentJson,
        string? fallbackStatus)
    {
        var facts = existing.ToDictionary(static x => x.SubjectId, StringComparer.Ordinal);
        using var document = JsonDocument.Parse(paymentJson);
        var root = document.RootElement;
        var invoiceSubjectId = ReadString(root, "invoice_subject_id");
        if (string.IsNullOrWhiteSpace(invoiceSubjectId))
        {
            return existing;
        }

        var reference = ReadString(root, "invoice_number") ?? invoiceSubjectId;
        var status = ReadString(root, "status") ?? fallbackStatus;
        facts[invoiceSubjectId] = new AccountingMemoryFact("invoice", invoiceSubjectId, reference, status);
        return facts.Values.ToArray();
    }

    private static IReadOnlyList<AccountingMemoryFact> MergeFacts(
        IReadOnlyList<AccountingMemoryFact> existing,
        IReadOnlyList<AccountingMemoryFact> incoming)
    {
        if (incoming.Count == 0)
        {
            return existing;
        }

        var facts = existing.ToDictionary(static x => x.SubjectId, StringComparer.Ordinal);
        foreach (var fact in incoming)
        {
            facts[fact.SubjectId] = fact;
        }

        return facts.Values.ToArray();
    }

    private static string? ReadString(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }

        return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
    }

    private static string ShortHash(params string?[] parts)
    {
        using var sha = SHA256.Create();
        var bytes = Encoding.UTF8.GetBytes(string.Join("|", parts.Select(static x => x ?? string.Empty)));
        return Convert.ToHexString(sha.ComputeHash(bytes))[..12].ToLowerInvariant();
    }
}
