using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Aven.Capabilities.Contracts.Responses;
using Aven.Roles.Support;

namespace Aven.Tests.E2E;

public sealed partial class Phase27ApiProductPathTests
{
    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task Api_AccountingInvoiceAndStatement_ProducesLedgerArtifactRevisionChain()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_accounting_invoice_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-777", 125.50m) } } }
            },
            usage = new { input_tokens = 12, output_tokens = 8, total_tokens = 20 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_accounting_statement_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingStatementStructuredOutput("STMT-777", "INV-777") } } }
            },
            usage = new { input_tokens = 11, output_tokens = 7, total_tokens = 18 }
        });
        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-ledger-chain-api",
            roleName = "accountant",
            displayName = "Accountant",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf", "image", "text" },
            primarySchemas = new[]
            {
                "schema://accounting/invoice@3",
                "schema://accounting/account-statement@3",
                "schema://accounting/statement-transaction@3",
                "schema://accounting/payment-match@3",
            },
            routingDescription = "Routes invoices and statements"
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var invoiceArtifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");
        var invoiceMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase28-accounting-invoice",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });

        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);
        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-777", "agent-accountant-ledger-chain-api", client);
        _ = await WaitForAgentSettledAsync(client, "agent-accountant-ledger-chain-api", "invoice_recorded", expectedRoleMemoryFragment: "INV-777");

        var statementArtifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");
        var statementMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase28-accounting-statement",
            incomingItemRef = statementArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { statementArtifactId },
            contentSummary = "bank statement pdf with transaction reference INV-777",
            proposedIntent = "accounting.statement",
            proposedReason = "statement upload",
            requiredSchemas = new[] { "schema://accounting/account-statement@3" }
        });

        Assert.Equal(HttpStatusCode.OK, statementMessageResponse.StatusCode);

        var agentJson = await WaitForAgentStateAsync(client, "agent-accountant-ledger-chain-api", "Idle", expectedLastRunSummary: "paid");
        Assert.Equal("paid", agentJson.GetProperty("lastRunSummary").GetString());

        var metadata = await client.GetFromJsonAsync<JsonElement>("/api/metadata");
        Assert.Contains(metadata.EnumerateArray(), item => item.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://accounting/invoice@3" && item.GetProperty("json").GetString()!.Contains("INV-777", StringComparison.Ordinal));
        Assert.Contains(metadata.EnumerateArray(), item => item.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://accounting/account-statement@3" && item.GetProperty("json").GetString()!.Contains("STMT-777", StringComparison.Ordinal));
        Assert.Contains(metadata.EnumerateArray(), item => item.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://accounting/statement-transaction@3" && item.GetProperty("json").GetString()!.Contains("TX-STMT-777", StringComparison.Ordinal));
        Assert.Contains(metadata.EnumerateArray(), item => item.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://accounting/payment-match@3" && item.GetProperty("json").GetString()!.Contains("paid", StringComparison.Ordinal));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task Api_AccountingInvoiceAndStatement_WithSlowStatementExtraction_DoesNotTripOperationDeliveryRetryBudget()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_accounting_invoice_slow_statement_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-777", 125.50m) } } }
            },
            usage = new { input_tokens = 12, output_tokens = 8, total_tokens = 20 }
        });
        providerResponses.Enqueue(new DelayedProviderResponse(
            900,
            new
            {
                id = "resp_accounting_statement_slow_1",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = AccountingStatementStructuredOutput("STMT-777", "INV-777") } } }
                },
                usage = new { input_tokens = 11, output_tokens = 7, total_tokens = 18 }
            }));
        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-ledger-chain-api-slow",
            roleName = "accountant",
            displayName = "Accountant",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf", "image", "text" },
            primarySchemas = new[]
            {
                "schema://accounting/invoice@3",
                "schema://accounting/account-statement@3",
                "schema://accounting/statement-transaction@3",
                "schema://accounting/payment-match@3",
            },
            routingDescription = "Routes invoices and statements"
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var invoiceArtifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");
        var invoiceMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase28-accounting-invoice-slow-statement",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });

        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);
        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-777", "agent-accountant-ledger-chain-api-slow", client);
        _ = await WaitForAgentSettledAsync(client, "agent-accountant-ledger-chain-api-slow", "invoice_recorded", expectedRoleMemoryFragment: "INV-777");

        var statementArtifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");
        var statementMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase28-accounting-statement-slow-statement",
            incomingItemRef = statementArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { statementArtifactId },
            contentSummary = "bank statement pdf with transaction reference INV-777",
            proposedIntent = "accounting.statement",
            proposedReason = "statement upload",
            requiredSchemas = new[] { "schema://accounting/account-statement@3" }
        });

        Assert.Equal(HttpStatusCode.OK, statementMessageResponse.StatusCode);

        var agentJson = await WaitForAgentStateAsync(client, "agent-accountant-ledger-chain-api-slow", "Idle", expectedLastRunSummary: "paid");
        Assert.Equal("paid", agentJson.GetProperty("lastRunSummary").GetString());
        Assert.DoesNotContain("delivery_retry_exhausted", agentJson.GetRawText(), StringComparison.OrdinalIgnoreCase);

        var metadata = await client.GetFromJsonAsync<JsonElement>("/api/metadata");
        Assert.Contains(metadata.EnumerateArray(), item => item.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://accounting/payment-match@3" && item.GetProperty("json").GetString()!.Contains("paid", StringComparison.Ordinal));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task Api_TwoAccountants_DoNotOverwriteEachOthersResourceCapabilities()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_accounting_invoice_multi_a",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-MULTI-A", 125.50m) } } }
            },
            usage = new { input_tokens = 12, output_tokens = 8, total_tokens = 20 }
        });

        var client = CreateClient(providerResponses, out _);

        var createAgentAResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-multi-a",
            roleName = "accountant",
            displayName = "Accountant A",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf", "image", "text" },
            primarySchemas = new[]
            {
                "schema://accounting/invoice@3",
                "schema://accounting/account-statement@3",
                "schema://accounting/statement-transaction@3",
                "schema://accounting/payment-match@3",
            },
            routingDescription = "Routes invoices and statements for team A",
            examplesOfRelevantInput = new[] { "team alpha accounting invoice" },
            examplesOfIrrelevantInput = new[] { "contract renewal notice" }
        });
        Assert.Equal(HttpStatusCode.Created, createAgentAResponse.StatusCode);

        var createAgentBResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-multi-b",
            roleName = "accountant",
            displayName = "Accountant B",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf", "image", "text" },
            primarySchemas = new[]
            {
                "schema://accounting/invoice@3",
                "schema://accounting/account-statement@3",
                "schema://accounting/statement-transaction@3",
                "schema://accounting/payment-match@3",
            },
            routingDescription = "Routes invoices and statements for team B",
            examplesOfRelevantInput = new[] { "team beta accounting invoice" },
            examplesOfIrrelevantInput = new[] { "research digest" }
        });
        Assert.Equal(HttpStatusCode.Created, createAgentBResponse.StatusCode);

        var invoiceArtifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");
        var invoiceMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase28-accounting-multi-a-invoice",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "team alpha accounting invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });
        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);

        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-MULTI-A");
        var agentJson = await WaitForAgentSettledAsync(client, "agent-accountant-multi-a", "invoice_recorded", expectedRoleMemoryFragment: "INV-MULTI-A");
        Assert.Equal("invoice_recorded", agentJson.GetProperty("lastRunSummary").GetString());

        var promptsResponse = await client.GetAsync("/api/human/prompts");
        Assert.Equal(HttpStatusCode.OK, promptsResponse.StatusCode);
        var promptsJson = await promptsResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(promptsJson.EnumerateArray());

        var operationsResponse = await client.GetAsync("/api/agents/agent-accountant-multi-a");
        Assert.Equal(HttpStatusCode.OK, operationsResponse.StatusCode);
        var operationsJson = await operationsResponse.Content.ReadFromJsonAsync<JsonElement>();
        var pendingOperations = operationsJson.GetProperty("pendingOperations").EnumerateArray().ToArray();
        Assert.Empty(pendingOperations);
        Assert.Equal("invoice_recorded", operationsJson.GetProperty("lastRunSummary").GetString());
    }
    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task Runtime_SeedsOnlyAgentScopedRoleCapabilities()
    {
        var client = CreateClient(new Queue<object>(), out _);

        foreach (var agentId in new[] { "agent-accountant-scoped-a", "agent-accountant-scoped-b" })
        {
            var response = await client.PostAsJsonAsync("/api/agents", new
            {
                roleAgentId = agentId,
                roleName = "accountant",
                displayName = "Accountant",
                objective = "Handle invoices and statements",
                responsibilityScope = "Accounting documents",
                acceptedInputTypes = new[] { "pdf", "image", "text" },
                primarySchemas = new[] { "schema://accounting/invoice@3" }
            });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        var authority = GetCapabilityAuthority();
        Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateCapabilityRequest(
            RoleCapabilityIds.ForRoleAgent(new RoleAgentId("agent-accountant-scoped-a"), "human-review"),
            "agent/agent-accountant-scoped-a",
            "resource/human",
            "human.approve")));
        Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateCapabilityRequest(
            RoleCapabilityIds.ForRoleAgent(new RoleAgentId("agent-accountant-scoped-b"), "human-review"),
            "agent/agent-accountant-scoped-b",
            "resource/human",
            "human.approve")));

        var legacyCapabilityId = "human-review" + "-cap";
        var legacy = Assert.IsType<CapabilityRejected>(authority.Admit(CreateCapabilityRequest(
            legacyCapabilityId,
            "agent/agent-accountant-scoped-a",
            "resource/human",
            "human.approve")));
        Assert.Equal("capability_missing", legacy.Error.Code);
    }

    private static string ResourceAddressFor(string resourceKind) => resourceKind switch
    {
        "llm" => "resource/llm",
        "metadata" => "resource/metadata",
        "artifact" => "resource/artifact",
        "schedule" => "resource/schedule",
        "human" => "resource/human",
        _ => throw new InvalidOperationException($"Unknown resource kind '{resourceKind}'.")
    };
}