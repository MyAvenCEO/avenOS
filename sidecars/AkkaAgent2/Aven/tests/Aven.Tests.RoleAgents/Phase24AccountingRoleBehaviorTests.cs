using System.Text.Json;
using Aven.Contracts.Protocol;
using Aven.Roles.Enums;
using Aven.Roles.Models;
using Aven.Roles.Support;
using Aven.Roles.Accounting.Metadata;
using Aven.Roles.Accounting.Schemas;

namespace Aven.Tests.RoleAgents;

public sealed class Phase24AccountingRoleBehaviorTests
{
    [Fact]
    public void AccountingRole_InvoiceExtraction_EmitsMetadataWrite_ThenMetadataQuery_AfterStoreCompletes()
    {
        var handler = GetHandler();
        var agentId = new RoleAgentId("agent-accounting-invoice");

        var ingest = handler.Apply(
            CreateResolved(
                new ActorAddress("intake/accountant", "local"),
                "invoice-input",
                "accounting.ingest_document",
                "corr-invoice-input",
                JsonSerializer.Serialize(CreateCommand(agentId, "claim-invoice", "artifact-test-invoice", "accounting.invoice", "invoice upload", "invoice reason"))),
            new RoleBehaviorContext(agentId, handler.CreateInitialStateJson(), Array.Empty<RoleOperation>()));

        var extract = Assert.Single(ingest.OperationsToRequest);
        Assert.Equal(ResourceOperationTypes.LlmGenerate, extract.TargetOperationType);

        var extracted = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/llm", "local"),
                extract.RequestId,
                ResourceOperationTypes.LlmGenerate,
                extract.CorrelationId.Value,
                InvoiceExtractionJson("INV-100")),
            new RoleBehaviorContext(agentId, ingest.RoleStateJson, ingest.OperationsToRequest));

        Assert.Equal(RoleBehaviorStatus.WaitingForOperation, extracted.Status);
        Assert.Equal("invoice_recorded", extracted.FinalResult);
        var metadataWrite = Assert.Single(extracted.OperationsToRequest);
        Assert.Equal(ResourceOperationTypes.MetadataCreate, metadataWrite.TargetOperationType);
        Assert.StartsWith("invoice-metadata-", metadataWrite.RequestId, StringComparison.Ordinal);
        Assert.DoesNotContain("artifact.", extracted.OperationsToRequest.Select(x => x.TargetOperationType));

        var afterMetadata = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/metadata", "local"),
                metadataWrite.RequestId,
                ResourceOperationTypes.MetadataCreate,
                "corr-invoice-metadata",
                "{\"recordId\":\"invoice-meta-1\"}"),
            new RoleBehaviorContext(agentId, extracted.RoleStateJson, extracted.OperationsToRequest));

        Assert.Equal(RoleBehaviorStatus.WaitingForOperation, afterMetadata.Status);
        var query = Assert.Single(afterMetadata.OperationsToRequest);
        Assert.Equal(ResourceOperationTypes.MetadataQuery, query.TargetOperationType);

        var stateJson = Assert.IsType<string>(afterMetadata.RoleStateJson);
        Assert.DoesNotContain("structuredJson", stateJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("transactions", stateJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("statements", stateJson, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AccountingRole_StatementExtraction_EmitsStatementAndTransactionMetadata_ThenMetadataQuery()
    {
        var handler = GetHandler();
        var agentId = new RoleAgentId("agent-accounting-statement");

        var ingest = handler.Apply(
            CreateResolved(
                new ActorAddress("intake/accountant", "local"),
                "statement-input",
                "accounting.ingest_document",
                "corr-statement-input",
                JsonSerializer.Serialize(CreateCommand(agentId, "claim-statement", "artifact-test-statement", "accounting.statement", "statement upload", "statement reason"))),
            new RoleBehaviorContext(agentId, handler.CreateInitialStateJson(), Array.Empty<RoleOperation>()));

        var extract = Assert.Single(ingest.OperationsToRequest);
        var extracted = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/llm", "local"),
                extract.RequestId,
                ResourceOperationTypes.LlmGenerate,
                extract.CorrelationId.Value,
                StatementExtractionJson("STMT-100", "INV-100", 125.50m)),
            new RoleBehaviorContext(agentId, ingest.RoleStateJson, ingest.OperationsToRequest));

        Assert.Equal(RoleBehaviorStatus.WaitingForOperation, extracted.Status);
        Assert.Equal("statement_recorded", extracted.FinalResult);
        Assert.Equal(2, extracted.OperationsToRequest.Count);
        Assert.Contains(extracted.OperationsToRequest, x => x.RequestId.StartsWith("statement-metadata-", StringComparison.Ordinal));
        Assert.Contains(extracted.OperationsToRequest, x => x.RequestId.StartsWith("statement-transaction-", StringComparison.Ordinal));
        Assert.DoesNotContain(extracted.OperationsToRequest, x => x.TargetOperationType.StartsWith("artifact.", StringComparison.Ordinal));

        var statementWrite = extracted.OperationsToRequest.Single(x => x.RequestId.StartsWith("statement-metadata-", StringComparison.Ordinal));
        var afterStatementMetadata = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/metadata", "local"),
                statementWrite.RequestId,
                ResourceOperationTypes.MetadataCreate,
                "corr-statement-metadata",
                "{\"recordId\":\"statement-meta-1\"}"),
            new RoleBehaviorContext(agentId, extracted.RoleStateJson, extracted.OperationsToRequest));

        Assert.Equal(RoleBehaviorStatus.WaitingForOperation, afterStatementMetadata.Status);
        Assert.Empty(afterStatementMetadata.OperationsToRequest);

        var transactionWrite = extracted.OperationsToRequest.Single(x => x.RequestId.StartsWith("statement-transaction-", StringComparison.Ordinal));
        Assert.StartsWith("statement-transaction-", transactionWrite.RequestId, StringComparison.Ordinal);

        var afterTransactionMetadata = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/metadata", "local"),
                transactionWrite.RequestId,
                ResourceOperationTypes.MetadataCreate,
                "corr-statement-transaction",
                "{\"recordId\":\"statement-tx-1\"}"),
            new RoleBehaviorContext(agentId, afterStatementMetadata.RoleStateJson, extracted.OperationsToRequest));

        var query = Assert.Single(afterTransactionMetadata.OperationsToRequest);
        Assert.Equal(ResourceOperationTypes.MetadataQuery, query.TargetOperationType);
    }

    [Fact]
    public void AccountingRole_MetadataQuery_ExactMatch_EmitsPaidPaymentMatchMetadata()
    {
        var handler = GetHandler();
        var agentId = new RoleAgentId("agent-accounting-paid");
        var state = JsonSerializer.Serialize(new AccountingRoleState(
            Array.Empty<AccountingPendingIngestion>(),
            Array.Empty<AccountingPendingDocumentStorage>(),
            [new AccountingPendingMatchRefresh("accounting-match-refresh-1", "invoice", "invoice:test")],
            Array.Empty<AccountingPendingHumanReview>(),
            Array.Empty<AccountingMemoryFact>(),
            null));

        var result = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/metadata", "local"),
                "accounting-match-refresh-1",
                ResourceOperationTypes.MetadataQuery,
                "corr-match-paid",
                JsonSerializer.Serialize(BuildMetadataQueryResultForExactMatch())),
            new RoleBehaviorContext(agentId, state, new[]
            {
                RoleBehaviorSupport.MetadataQuery("accounting-match-refresh-1", new CorrelationId("corr-match-paid"), new MetadataQueryOperationPayload("accounting-match-refresh-1"))
            }));

        Assert.Equal(RoleBehaviorStatus.WaitingForOperation, result.Status);
        Assert.Equal("paid", result.FinalResult);
        var operation = Assert.Single(result.OperationsToRequest);
        Assert.Equal(ResourceOperationTypes.MetadataCreate, operation.TargetOperationType);
        var payload = JsonSerializer.Deserialize<MetadataWriteOperationPayload>(operation.Payload.Json)!;
        using var doc = JsonDocument.Parse(payload.Json);
        Assert.Equal("paid", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public void AccountingRole_MetadataQuery_ForeignCurrencyPayment_MatchesViaOriginalAmount()
    {
        var handler = GetHandler();
        var agentId = new RoleAgentId("agent-accounting-fx");
        var state = JsonSerializer.Serialize(new AccountingRoleState(
            Array.Empty<AccountingPendingIngestion>(),
            Array.Empty<AccountingPendingDocumentStorage>(),
            [new AccountingPendingMatchRefresh("accounting-match-refresh-fx", "invoice", "invoice:fx")],
            Array.Empty<AccountingPendingHumanReview>(),
            Array.Empty<AccountingMemoryFact>(),
            null));

        var result = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/metadata", "local"),
                "accounting-match-refresh-fx",
                ResourceOperationTypes.MetadataQuery,
                "corr-match-fx",
                JsonSerializer.Serialize(BuildMetadataQueryResultForFxMatch())),
            new RoleBehaviorContext(agentId, state, new[]
            {
                RoleBehaviorSupport.MetadataQuery("accounting-match-refresh-fx", new CorrelationId("corr-match-fx"), new MetadataQueryOperationPayload("accounting-match-refresh-fx"))
            }));

        // A USD invoice settled via an FX (EUR-booked) transaction is matched on the transaction's
        // original USD leg, and the recorded match uses the invoice's own currency/amount.
        var matchWrite = result.OperationsToRequest.FirstOrDefault(o => o.TargetOperationType == ResourceOperationTypes.MetadataCreate);
        Assert.NotNull(matchWrite);
        var payload = JsonSerializer.Deserialize<MetadataWriteOperationPayload>(matchWrite!.Payload.Json)!;
        using var doc = JsonDocument.Parse(payload.Json);
        var root = doc.RootElement;
        Assert.Contains("amount", root.GetProperty("matched_on").EnumerateArray().Select(static x => x.GetString()));
        Assert.Equal("USD", root.GetProperty("matched_amount").GetProperty("currency").GetString());
        Assert.Equal(2975, root.GetProperty("matched_amount").GetProperty("minor_units").GetInt64());
    }

    [Theory]
    [InlineData("approve", "paid")]
    [InlineData("reject", "unpaid")]
    public void AccountingRole_HumanReview_RecordsApprovedOrRejectedPaymentMatch(string answer, string expectedStatus)
    {
        var handler = GetHandler();
        var agentId = new RoleAgentId("agent-accounting-review");
        var promptId = "payment-match-review-test";
        var state = JsonSerializer.Serialize(new AccountingRoleState(
            Array.Empty<AccountingPendingIngestion>(),
            Array.Empty<AccountingPendingDocumentStorage>(),
            Array.Empty<AccountingPendingMatchRefresh>(),
            [new AccountingPendingHumanReview(promptId, "match:test", ReviewPaymentMatchJson("paid"), ReviewPaymentMatchJson("unpaid"))],
            Array.Empty<AccountingMemoryFact>(),
            null));

        var result = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/human", "local"),
                promptId,
                ResourceOperationTypes.HumanApprove,
                "corr-review",
                $"{{\"answer\":\"{answer}\"}}"),
            new RoleBehaviorContext(agentId, state, Array.Empty<RoleOperation>()));

        Assert.Equal(expectedStatus, result.FinalResult);
        var op = Assert.Single(result.OperationsToRequest);
        Assert.Equal(ResourceOperationTypes.MetadataCreate, op.TargetOperationType);
        var payload = JsonSerializer.Deserialize<MetadataWriteOperationPayload>(op.Payload.Json)!;
        Assert.Equal(AccountingSchemaRefs.PaymentMatchV3, payload.SchemaRef);
        using var doc = JsonDocument.Parse(payload.Json);
        Assert.Equal(expectedStatus, doc.RootElement.GetProperty("status").GetString());
    }

    private static string ReviewPaymentMatchJson(string status) => JsonSerializer.Serialize(new
    {
        match_id = $"match:test:{status}",
        invoice_subject_id = "invoice:test",
        status,
        confidence = 0.6,
        reason = $"human review {status}",
        invoice_amount = EurMoney(18m),
        matched_amount = status == "paid" ? (object)EurMoney(18m) : null!,
        currency = "EUR",
        matched_on = new[] { "amount" }
    });

    [Fact]
    public void AccountingRole_MetadataQuery_BorderlineMatch_EmitsNeedsReview_AndHumanPrompt_WithoutStateJsonLeakage()
    {
        var handler = GetHandler();
        var agentId = new RoleAgentId("agent-accounting-review");
        var state = JsonSerializer.Serialize(new AccountingRoleState(
            Array.Empty<AccountingPendingIngestion>(),
            Array.Empty<AccountingPendingDocumentStorage>(),
            [new AccountingPendingMatchRefresh("accounting-match-refresh-2", "invoice", "invoice:test")],
            Array.Empty<AccountingPendingHumanReview>(),
            Array.Empty<AccountingMemoryFact>(),
            null));

        var result = handler.Apply(
            CreateResolved(
                new ActorAddress("resource/metadata", "local"),
                "accounting-match-refresh-2",
                ResourceOperationTypes.MetadataQuery,
                "corr-match-review",
                JsonSerializer.Serialize(BuildMetadataQueryResultForBorderlineMatch())),
            new RoleBehaviorContext(agentId, state, new[]
            {
                RoleBehaviorSupport.MetadataQuery("accounting-match-refresh-2", new CorrelationId("corr-match-review"), new MetadataQueryOperationPayload("accounting-match-refresh-2"))
            }));

        Assert.Equal(RoleBehaviorStatus.WaitingForOperation, result.Status);
        Assert.Equal(2, result.OperationsToRequest.Count);
        Assert.Contains(result.OperationsToRequest, x => x.TargetOperationType == ResourceOperationTypes.MetadataCreate);
        Assert.Contains(result.OperationsToRequest, x => x.TargetOperationType == ResourceOperationTypes.HumanApprove);
        var metadataPayload = JsonSerializer.Deserialize<MetadataWriteOperationPayload>(result.OperationsToRequest.Single(x => x.TargetOperationType == ResourceOperationTypes.MetadataCreate).Payload.Json)!;
        using var doc = JsonDocument.Parse(metadataPayload.Json);
        Assert.Equal("needs_review", doc.RootElement.GetProperty("status").GetString());

        var stateJson = Assert.IsType<string>(result.RoleStateJson);
        Assert.DoesNotContain("structuredJson", stateJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("transactions", stateJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("statements", stateJson, StringComparison.OrdinalIgnoreCase);
    }

    private static Aven.Roles.Interfaces.IRoleBehaviorHandler GetHandler() =>
        Assert.IsAssignableFrom<Aven.Roles.Interfaces.IRoleBehaviorHandler>(BuiltInRoleBehaviorCatalog.GetHandler("accountant"));

    private static AccountingDocumentCommand CreateCommand(
        RoleAgentId agentId,
        string claimId,
        string incomingItemRef,
        string proposedIntent,
        string contentSummary,
        string proposedReason) =>
        new(
            new RoutingAttemptId($"route-{claimId}"),
            new WorkOfferId($"offer-{claimId}"),
            new WorkClaimId(claimId),
            agentId,
            incomingItemRef,
            [incomingItemRef],
            contentSummary,
            proposedIntent,
            proposedReason,
            proposedIntent.Contains("statement", StringComparison.OrdinalIgnoreCase)
                ? [AccountingSchemaRefs.AccountStatementV3]
                : [AccountingSchemaRefs.InvoiceV3],
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"));

    private static OperationResolved CreateResolved(ActorAddress caller, string requestId, string operationType, string correlationId, string payloadJson) =>
        new(
            new OperationKey(caller, new RequestId(requestId), operationType),
            new CorrelationId(correlationId),
            caller,
            caller,
            new OperationValue(operationType, payloadJson));

    private static string InvoiceExtractionJson(string invoiceNumber) => JsonSerializer.Serialize(new
    {
        structuredJson = new
        {
            vendor = new { name = "Example GmbH", banking_accounts = Array.Empty<object>() },
            buyer = new { name = "Buyer GmbH", banking_accounts = Array.Empty<object>() },
            header = new
            {
                document_kind = "invoice",
                letter_date = "2026-01-05",
                due_date = "2026-01-31",
                referenced_invoice_numbers = Array.Empty<string>(),
                issue_date = "2026-01-05",
                invoice_number = invoiceNumber,
                order_number = (string?)null,
                customer_number = (string?)null,
                reference_entries = Array.Empty<object>(),
                currency = "EUR"
            },
            payment_instructions = "Transfer",
            totals = new { subtotal = 100m, tax_breakdown = Array.Empty<object>(), tax_total = 25.5m, invoice_total = 125.5m },
            payments = Array.Empty<object>(),
            total_outstanding = 125.5m,
            statements = new[]
            {
                new { section_title = "Services", service_period = "2026-01", line_items = Array.Empty<object>(), line_groups = Array.Empty<object>(), service_period_normalized = (object?)null }
            }
        },
        artifactId = "artifact-test-invoice",
        revisionId = "revision-test-invoice"
    });

    private static string StatementExtractionJson(string statementId, string invoiceNumber, decimal amount) => JsonSerializer.Serialize(new
    {
        structuredJson = new
        {
            statement_kind = "periodic_account_statement",
            statement_id = statementId,
            statement_issue_date = "2026-02-01",
            currency = "EUR",
            period_start = "2026-01-01",
            period_end = "2026-02-10",
            payment_due_date = (string?)null,
            opening_balance = 0m,
            closing_balance = 1000m,
            account_holder = new { name = "Buyer GmbH" },
            institution = new { name = "Bank AG" },
            account_overview = new { iban = "DE123", bic = "BANKDEFF", account_number = "123", product_name = "Business" },
            transactions = new[]
            {
                new
                {
                    booking_date = "2026-02-03",
                    booking_date_as_printed = "03.02.2026",
                    value_date = "2026-02-03",
                    description = $"Payment {invoiceNumber}",
                    counterparty_name = "Example GmbH",
                    transaction_id = $"TX-{statementId}",
                    amount = -amount,
                    title = "Invoice payment",
                    fx_surcharge_eur = (decimal?)null,
                    original_amount = (decimal?)null,
                    original_currency = (string?)null,
                    exchange_rate = (string?)null,
                    balance_after = 874.5m
                }
            },
            notes = (string?)null
        },
        artifactId = "artifact-test-statement",
        revisionId = "revision-test-statement"
    });

    private static MetadataQueryOperationResult BuildMetadataQueryResultForExactMatch()
    {
        var invoiceSubjectId = "invoice:examplegmbh:inv100:abc123";
        var statementSubjectId = "statement:bankag:def456";
        return new MetadataQueryOperationResult(
            [
                new MetadataRecordSnapshot("r1", "accounting-invoice", invoiceSubjectId, "artifact-test-invoice", "revision-test-invoice", AccountingSchemaRefs.InvoiceV3.Value, InvoiceStructuredJson("INV-100"), "h1", DateTimeOffset.UtcNow, "invoice"),
                new MetadataRecordSnapshot("r2", "accounting-account-statement", statementSubjectId, "artifact-test-statement", "revision-test-statement", AccountingSchemaRefs.AccountStatementV3.Value, StatementStructuredJson("STMT-100", "INV-100", 125.5m), "h2", DateTimeOffset.UtcNow, "statement")
            ],
            false,
            200);
    }

    private static MetadataQueryOperationResult BuildMetadataQueryResultForBorderlineMatch()
    {
        var invoiceSubjectId = "invoice:examplegmbh:inv101:abc123";
        var statementSubjectId = "statement:bankag:def456";
        return new MetadataQueryOperationResult(
            [
                new MetadataRecordSnapshot("r1", "accounting-invoice", invoiceSubjectId, "artifact-test-invoice", "revision-test-invoice", AccountingSchemaRefs.InvoiceV3.Value, InvoiceStructuredJson("INV-101"), "h1", DateTimeOffset.UtcNow, "invoice"),
                new MetadataRecordSnapshot("r2", "accounting-account-statement", statementSubjectId, "artifact-test-statement", "revision-test-statement", AccountingSchemaRefs.AccountStatementV3.Value, StatementStructuredJson("STMT-101", "OTHER-REF", 125.5m), "h2", DateTimeOffset.UtcNow, "statement")
            ],
            false,
            200);
    }

    // Canonical @3 EUR money object: minor_units = amount * 100.
    private static object EurMoney(decimal amount) => new { amount, currency = "EUR", minor_units = (long)(amount * 100m) };

    // Canonical invoice@3 record (flat fields + Money objects) as STORED and read by the matcher.
    private static string InvoiceStructuredJson(string invoiceNumber) => JsonSerializer.Serialize(new
    {
        vendor_name = "Example GmbH",
        invoice_number = invoiceNumber,
        issue_date = "2026-01-05",
        due_date = "2026-01-31",
        currency = "EUR",
        subtotal = EurMoney(100m),
        tax_total = EurMoney(25.5m),
        invoice_total = EurMoney(125.5m),
        total_outstanding = EurMoney(125.5m),
        normalization = new { source_schema = "schema://accounting/invoice-extraction@1", issues = Array.Empty<object>() },
        source_document = new { }
    });

    // Canonical account-statement@3 record (flat fields, canonical transactions with Money amounts).
    private static string StatementStructuredJson(string statementId, string reference, decimal amount) => JsonSerializer.Serialize(new
    {
        institution_name = "Bank AG",
        account_iban = "DE123",
        currency = "EUR",
        period_start = "2026-01-01",
        period_end = "2026-02-10",
        opening_balance = EurMoney(0m),
        closing_balance = EurMoney(1000m),
        transaction_count = 1,
        transactions = new[]
        {
            new
            {
                transaction_id = $"TX-{statementId}",
                transaction_index = 0,
                booking_date = "2026-02-03",
                booking_date_as_printed = "03.02.2026",
                value_date = "2026-02-03",
                description = $"Payment {reference}",
                counterparty_name = "Example GmbH",
                title = "Invoice payment",
                amount = EurMoney(-amount),
                direction = "debit",
                original_amount = (object?)null,
                original_currency = (string?)null,
                exchange_rate = (string?)null,
                balance_after = EurMoney(874.5m)
            }
        },
        normalization = new { source_schema = "schema://accounting/account-statement-extraction@1", issues = Array.Empty<object>() },
        source_document = new { }
    });

    private static object UsdMoney(decimal amount) => new { amount, currency = "USD", minor_units = (long)(amount * 100m) };

    // USD invoice that has no EUR-native amount on the statement's booked leg — it can only be matched
    // via the transaction's original (USD) leg.
    private static string UsdInvoiceStructuredJson(string invoiceNumber) => JsonSerializer.Serialize(new
    {
        vendor_name = "Anthropic, PBC",
        invoice_number = invoiceNumber,
        issue_date = "2026-01-20",
        due_date = "2026-01-20",
        currency = "USD",
        subtotal = UsdMoney(29.75m),
        tax_total = (object?)null,
        invoice_total = UsdMoney(29.75m),
        total_outstanding = UsdMoney(29.75m),
        normalization = new { source_schema = "schema://accounting/invoice-extraction@1", issues = Array.Empty<object>() },
        source_document = new { }
    });

    // Foreign-currency payment: booked in EUR (statement currency) with the original USD leg recorded.
    // Description carries neither the invoice number nor the legal vendor name, so only the amount hint can fire.
    private static string FxStatementStructuredJson() => JsonSerializer.Serialize(new
    {
        institution_name = "FINOM PAYMENTS B.V.",
        account_iban = "DE03",
        currency = "EUR",
        period_start = "2026-01-01",
        period_end = "2026-01-31",
        opening_balance = EurMoney(0m),
        closing_balance = EurMoney(1000m),
        transaction_count = 1,
        transactions = new[]
        {
            new
            {
                transaction_id = "tx-fx",
                transaction_index = 0,
                booking_date = "2026-01-21",
                booking_date_as_printed = "21.01.2026",
                value_date = "2026-01-21",
                description = "ANTHROPIC",
                counterparty_name = (string?)null,
                title = (string?)null,
                amount = EurMoney(-25.70m),
                direction = "debit",
                original_amount = (object?)UsdMoney(-29.75m),
                original_currency = "USD",
                exchange_rate = "1.1575",
                balance_after = EurMoney(974.3m)
            }
        },
        normalization = new { source_schema = "schema://accounting/account-statement-extraction@1", issues = Array.Empty<object>() },
        source_document = new { }
    });

    private static MetadataQueryOperationResult BuildMetadataQueryResultForFxMatch() =>
        new(
            [
                new MetadataRecordSnapshot("r1", "accounting-invoice", "invoice:anthropicpbc:v1katlht0001:abc", "artifact-fx-invoice", "rev-fx-invoice", AccountingSchemaRefs.InvoiceV3.Value, UsdInvoiceStructuredJson("V1KATLHT-0001"), "h1", DateTimeOffset.UtcNow, "invoice"),
                new MetadataRecordSnapshot("r2", "accounting-account-statement", "statement:finompaymentsbv:def", "artifact-fx-stmt", "rev-fx-stmt", AccountingSchemaRefs.AccountStatementV3.Value, FxStatementStructuredJson(), "h2", DateTimeOffset.UtcNow, "statement")
            ],
            false,
            200);
}
