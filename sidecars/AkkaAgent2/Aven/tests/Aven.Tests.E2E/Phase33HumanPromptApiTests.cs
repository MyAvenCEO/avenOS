using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Aven.Api.Runtime;
using Aven.Roles.Support;

namespace Aven.Tests.E2E;

public sealed partial class Phase27ApiProductPathTests
{
    [Fact]
    public async Task Api_HumanPromptEndpoints_ListGetAnswerAndConflict()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_invoice",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-HUMAN-1", 125.50m) } } }
            },
            usage = new { input_tokens = 10, output_tokens = 8, total_tokens = 18 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_statement",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingStatementStructuredOutput("STMT-HUMAN-1", "UNMATCHED-REF") } } }
            },
            usage = new { input_tokens = 11, output_tokens = 7, total_tokens = 18 }
        });

        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-human-api",
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
            idempotencyKey = "api-phase33-human-invoice",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });
        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);
        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-HUMAN-1");
        _ = await WaitForAgentSettledAsync(client, "agent-accountant-human-api", "invoice_recorded", expectedRoleMemoryFragment: "INV-HUMAN-1");

        var statementArtifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");
        var statementMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase33-human-statement",
            incomingItemRef = statementArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { statementArtifactId },
            contentSummary = "bank statement pdf with uncertain transaction reference",
            proposedIntent = "accounting.statement",
            proposedReason = "statement upload",
            requiredSchemas = new[] { "schema://accounting/account-statement@3" }
        });
        Assert.Equal(HttpStatusCode.OK, statementMessageResponse.StatusCode);

        var prompt = await WaitForHumanPromptAsync(client, expectedPromptTextFragment: "INV-HUMAN-1");
        var promptId = prompt.GetProperty("promptId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(promptId));

        var listResponse = await client.GetAsync("/api/human/prompts");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var listJson = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        var listed = listJson.EnumerateArray().Single(x => x.GetProperty("promptId").GetString() == promptId);
        Assert.Equal("Open", listed.GetProperty("status").GetString());
        Assert.StartsWith("payment-match-review", listed.GetProperty("requestId").GetString(), StringComparison.Ordinal);
        Assert.Equal("human.approve", listed.GetProperty("operationType").GetString());
        Assert.Equal("corr-api-phase33-human-statement", listed.GetProperty("correlationId").GetString());
        Assert.Equal("local://resource/human", listed.GetProperty("owner").GetString());
        Assert.Equal("local://agent/agent-accountant-human-api", listed.GetProperty("replyTo").GetString());
        Assert.Equal(RoleCapabilityIds.ForRoleAgent(new RoleAgentId("agent-accountant-human-api"), "human-review"), listed.GetProperty("requiredCapabilityId").GetString());
        Assert.Contains("INV-HUMAN-1", listed.GetProperty("promptText").GetString(), StringComparison.Ordinal);

        var getResponse = await client.GetAsync($"/api/human/prompts/{promptId}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var getJson = await getResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, getJson.GetProperty("promptId").GetString());
        Assert.Equal("Open", getJson.GetProperty("status").GetString());
        Assert.StartsWith("payment-match-review", getJson.GetProperty("requestId").GetString(), StringComparison.Ordinal);
        Assert.Equal("human.approve", getJson.GetProperty("operationType").GetString());
        Assert.Equal("corr-api-phase33-human-statement", getJson.GetProperty("correlationId").GetString());
        Assert.Equal("local://resource/human", getJson.GetProperty("owner").GetString());
        Assert.Equal("local://agent/agent-accountant-human-api", getJson.GetProperty("replyTo").GetString());
        Assert.Equal(RoleCapabilityIds.ForRoleAgent(new RoleAgentId("agent-accountant-human-api"), "human-review"), getJson.GetProperty("requiredCapabilityId").GetString());
        Assert.Contains("INV-HUMAN-1", getJson.GetProperty("promptText").GetString(), StringComparison.Ordinal);
        Assert.Equal(JsonValueKind.Null, getJson.GetProperty("answer").ValueKind);

        var answerResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/answer", new { answer = "approve" });
        Assert.Equal(HttpStatusCode.OK, answerResponse.StatusCode);
        var answerJson = await answerResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, answerJson.GetProperty("promptId").GetProperty("value").GetString());
        Assert.Equal("approve", answerJson.GetProperty("answer").GetString());
        Assert.False(answerJson.GetProperty("idempotent").GetBoolean());
        Assert.False(answerJson.GetProperty("late").GetBoolean());

        var repeatResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/answer", new { answer = "approve" });
        Assert.Equal(HttpStatusCode.OK, repeatResponse.StatusCode);
        var repeatJson = await repeatResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, repeatJson.GetProperty("promptId").GetProperty("value").GetString());
        Assert.Equal("approve", repeatJson.GetProperty("answer").GetString());
        Assert.True(repeatJson.GetProperty("idempotent").GetBoolean());

        var conflictResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/answer", new { answer = "reject" });
        Assert.Equal(HttpStatusCode.Conflict, conflictResponse.StatusCode);
        var conflictJson = await conflictResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, conflictJson.GetProperty("promptId").GetProperty("value").GetString());
        Assert.Equal("prompt_answer_conflict", conflictJson.GetProperty("error").GetProperty("code").GetString());

        var answeredPrompt = await WaitForHumanPromptStatusAsync(client, promptId!, "Answered");
        Assert.Equal("approve", answeredPrompt.GetProperty("answer").GetString());
        Assert.NotEqual(JsonValueKind.Null, answeredPrompt.GetProperty("answeredAt").ValueKind);
    }

    [Fact]
    public async Task Api_HumanPromptEndpoints_UnknownPromptReturns404()
    {
        var client = CreateClient(new Queue<object>(), out _);

        var getResponse = await client.GetAsync("/api/human/prompts/unknown-prompt-id");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);

        var answerResponse = await client.PostAsJsonAsync("/api/human/prompts/unknown-prompt-id/answer", new { answer = "approve" });
        Assert.Equal(HttpStatusCode.NotFound, answerResponse.StatusCode);

        var cancelResponse = await client.PostAsJsonAsync("/api/human/prompts/unknown-prompt-id/cancel", new { reason = "not-found" });
        Assert.Equal(HttpStatusCode.NotFound, cancelResponse.StatusCode);
    }

    [Fact]
    public async Task Api_HumanPromptCancel_CancelsPromptAndRejectsAnswer()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_invoice_cancel",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-HUMAN-CANCEL", 325.50m) } } }
            },
            usage = new { input_tokens = 10, output_tokens = 8, total_tokens = 18 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_statement_cancel",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingStatementStructuredOutput("STMT-HUMAN-CANCEL", "UNMATCHED-REF-CANCEL", -325.50m) } } }
            },
            usage = new { input_tokens = 11, output_tokens = 7, total_tokens = 18 }
        });

        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-human-cancel-api",
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
            idempotencyKey = "api-phase33-human-cancel-invoice",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });
        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);
        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-HUMAN-CANCEL");
        _ = await WaitForAgentSettledAsync(client, "agent-accountant-human-cancel-api", "invoice_recorded", expectedRoleMemoryFragment: "INV-HUMAN-CANCEL");

        var statementArtifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");
        var statementMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase33-human-cancel-statement",
            incomingItemRef = statementArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { statementArtifactId },
            contentSummary = "bank statement pdf with uncertain transaction reference",
            proposedIntent = "accounting.statement",
            proposedReason = "statement upload",
            requiredSchemas = new[] { "schema://accounting/account-statement@3" }
        });
        Assert.Equal(HttpStatusCode.OK, statementMessageResponse.StatusCode);

        var prompt = await WaitForHumanPromptAsync(client, expectedPromptTextFragment: "INV-HUMAN-CANCEL");
        var promptId = prompt.GetProperty("promptId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(promptId));

        var cancelResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/cancel", new { reason = "user_cancelled" });
        Assert.Equal(HttpStatusCode.OK, cancelResponse.StatusCode);
        var cancelJson = await cancelResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, cancelJson.GetProperty("promptId").GetProperty("value").GetString());
        Assert.Equal("user_cancelled", cancelJson.GetProperty("reason").GetString());
        Assert.False(cancelJson.GetProperty("idempotent").GetBoolean());

        var cancelledPrompt = await WaitForHumanPromptStatusAsync(client, promptId!, "Cancelled");
        Assert.Equal(JsonValueKind.Null, cancelledPrompt.GetProperty("answer").ValueKind);

        var answerResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/answer", new { answer = "approve" });
        Assert.Equal(HttpStatusCode.BadRequest, answerResponse.StatusCode);
        var answerJson = await answerResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, answerJson.GetProperty("promptId").GetProperty("value").GetString());
        Assert.Equal("prompt_cancelled", answerJson.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Api_HumanPromptCancel_NotifiesRoleAgentAndClearsPendingHumanOperation()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_invoice_cancel_notify",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-HUMAN-CANCEL-NOTIFY", 525.50m) } } }
            },
            usage = new { input_tokens = 10, output_tokens = 8, total_tokens = 18 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_statement_cancel_notify",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingStatementStructuredOutput("STMT-HUMAN-CANCEL-NOTIFY", "UNMATCHED-REF-CANCEL-NOTIFY", -525.50m) } } }
            },
            usage = new { input_tokens = 11, output_tokens = 7, total_tokens = 18 }
        });

        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-human-cancel-notify-api",
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
            idempotencyKey = "api-phase33-human-cancel-notify-invoice",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });
        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);
        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-HUMAN-CANCEL-NOTIFY");
        _ = await WaitForAgentSettledAsync(client, "agent-accountant-human-cancel-notify-api", "invoice_recorded", expectedRoleMemoryFragment: "INV-HUMAN-CANCEL-NOTIFY");

        var statementArtifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");
        var statementMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase33-human-cancel-notify-statement",
            incomingItemRef = statementArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { statementArtifactId },
            contentSummary = "bank statement pdf with uncertain transaction reference",
            proposedIntent = "accounting.statement",
            proposedReason = "statement upload",
            requiredSchemas = new[] { "schema://accounting/account-statement@3" }
        });
        Assert.Equal(HttpStatusCode.OK, statementMessageResponse.StatusCode);

        var prompt = await WaitForHumanPromptAsync(client, expectedPromptTextFragment: "INV-HUMAN-CANCEL-NOTIFY");
        var promptId = prompt.GetProperty("promptId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(promptId));

        var cancelResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/cancel", new { reason = "user_cancelled" });
        Assert.Equal(HttpStatusCode.OK, cancelResponse.StatusCode);

        var cancelledPrompt = await WaitForHumanPromptStatusAsync(client, promptId!, "Cancelled");
        Assert.Equal(JsonValueKind.Null, cancelledPrompt.GetProperty("answer").ValueKind);

        JsonElement agentJson = default;
        string? lastAgentJson = null;
        for (var attempt = 0; attempt < 120; attempt++)
        {
            var response = await client.GetAsync("/api/agents/agent-accountant-human-cancel-notify-api");
            response.EnsureSuccessStatusCode();
            agentJson = (await response.Content.ReadFromJsonAsync<JsonElement>())!;
            lastAgentJson = agentJson.GetRawText();

            var status = agentJson.GetProperty("status").GetString();
            var summary = agentJson.GetProperty("lastRunSummary").GetString();
            var noPending = agentJson.GetProperty("pendingOperations").GetArrayLength() == 0;
            var noActiveRuns = agentJson.GetProperty("activeRuns").GetArrayLength() == 0;

            if (status == "Failed"
                && summary == "operation_cancelled"
                && noPending
                && noActiveRuns)
            {
                break;
            }

            await Task.Delay(100);
        }

        var finalStatus = agentJson.GetProperty("status").GetString();
        var finalSummary = agentJson.GetProperty("lastRunSummary").GetString();
        Assert.Equal("Failed", finalStatus);
        Assert.Equal("operation_cancelled", finalSummary);
        Assert.Equal(0, agentJson.GetProperty("pendingOperations").GetArrayLength());
        Assert.Equal(0, agentJson.GetProperty("activeRuns").GetArrayLength());
        Assert.True(agentJson.GetProperty("openWorkItems").GetArrayLength() >= 1);
    }

    [Fact]
    public async Task Api_HumanPromptCancel_MissingReasonReturnsBadRequest()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_invoice_missing_reason",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-HUMAN-MISSING-REASON", 425.50m) } } }
            },
            usage = new { input_tokens = 10, output_tokens = 8, total_tokens = 18 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_statement_missing_reason",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingStatementStructuredOutput("STMT-HUMAN-MISSING-REASON", "UNMATCHED-REF-MISSING-REASON", -425.50m) } } }
            },
            usage = new { input_tokens = 11, output_tokens = 7, total_tokens = 18 }
        });

        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-human-missing-reason-api",
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
            idempotencyKey = "api-phase33-human-missing-reason-invoice",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });
        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);
        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-HUMAN-MISSING-REASON");
        _ = await WaitForAgentSettledAsync(client, "agent-accountant-human-missing-reason-api", "invoice_recorded", expectedRoleMemoryFragment: "INV-HUMAN-MISSING-REASON");

        var statementArtifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");
        var statementMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase33-human-missing-reason-statement",
            incomingItemRef = statementArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { statementArtifactId },
            contentSummary = "bank statement pdf with uncertain transaction reference",
            proposedIntent = "accounting.statement",
            proposedReason = "statement upload",
            requiredSchemas = new[] { "schema://accounting/account-statement@3" }
        });
        Assert.Equal(HttpStatusCode.OK, statementMessageResponse.StatusCode);

        var prompt = await WaitForHumanPromptAsync(client, expectedPromptTextFragment: "INV-HUMAN-MISSING-REASON");
        var promptId = prompt.GetProperty("promptId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(promptId));

        var cancelResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/cancel", new { reason = "" });
        Assert.Equal(HttpStatusCode.BadRequest, cancelResponse.StatusCode);
        var cancelJson = await cancelResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, cancelJson.GetProperty("promptId").GetProperty("value").GetString());
        Assert.Equal("missing_cancel_reason", cancelJson.GetProperty("error").GetProperty("code").GetString());

        var stillOpenPrompt = await WaitForHumanPromptStatusAsync(client, promptId!, "Open");
        Assert.Equal(promptId, stillOpenPrompt.GetProperty("promptId").GetString());
        Assert.Equal("Open", stillOpenPrompt.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, stillOpenPrompt.GetProperty("answer").ValueKind);
    }

    [Fact]
    public async Task Runtime_AnswerHumanPrompt_UnresolvedOwnerStillAcceptsPromptAnswerAndKeepsPromptStateConsistent()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_invoice_runtime",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-HUMAN-2", 225.50m) } } }
            },
            usage = new { input_tokens = 10, output_tokens = 8, total_tokens = 18 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_human_prompt_statement_runtime",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingStatementStructuredOutput("STMT-HUMAN-2", "UNMATCHED-REF-2", -225.50m) } } }
            },
            usage = new { input_tokens = 11, output_tokens = 7, total_tokens = 18 }
        });

        var client = CreateClient(providerResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-human-unresolved-api",
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
            idempotencyKey = "api-phase33-human-runtime-invoice",
            incomingItemRef = invoiceArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { invoiceArtifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });
        Assert.Equal(HttpStatusCode.OK, invoiceMessageResponse.StatusCode);
        _ = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-HUMAN-2");
        _ = await WaitForAgentSettledAsync(client, "agent-accountant-human-unresolved-api", "invoice_recorded", expectedRoleMemoryFragment: "INV-HUMAN-2");

        var statementArtifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");
        var statementMessageResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase33-human-runtime-statement",
            incomingItemRef = statementArtifactId,
            inputType = "pdf",
            attachmentRefs = new[] { statementArtifactId },
            contentSummary = "bank statement pdf with uncertain transaction reference",
            proposedIntent = "accounting.statement",
            proposedReason = "statement upload",
            requiredSchemas = new[] { "schema://accounting/account-statement@3" }
        });
        Assert.Equal(HttpStatusCode.OK, statementMessageResponse.StatusCode);

        var prompt = await WaitForHumanPromptAsync(client, expectedPromptTextFragment: "INV-HUMAN-2");
        var promptId = prompt.GetProperty("promptId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(promptId));

        RemoveActorAddressRegistration(new ActorAddress("agent/agent-accountant-human-unresolved-api", "local"));

        var unresolvedResponse = await client.PostAsJsonAsync($"/api/human/prompts/{promptId}/answer", new { answer = "approve" });
        Assert.Equal(HttpStatusCode.OK, unresolvedResponse.StatusCode);
        var unresolvedJson = await unresolvedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(promptId, unresolvedJson.GetProperty("promptId").GetProperty("value").GetString());
        Assert.Equal("approve", unresolvedJson.GetProperty("answer").GetString());
        Assert.False(unresolvedJson.GetProperty("idempotent").GetBoolean());

        var answeredPrompt = await WaitForHumanPromptStatusAsync(client, promptId!, "Answered");
        Assert.Equal("approve", answeredPrompt.GetProperty("answer").GetString());
        Assert.NotEqual(JsonValueKind.Null, answeredPrompt.GetProperty("answeredAt").ValueKind);
    }

    private static async Task<JsonElement> WaitForHumanPromptAsync(HttpClient client, string expectedPromptTextFragment)
    {
        for (var attempt = 0; attempt < 60; attempt++)
        {
            var response = await client.GetAsync("/api/human/prompts");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (json.ValueKind == JsonValueKind.Array)
            {
                foreach (var prompt in json.EnumerateArray())
                {
                    if (prompt.GetProperty("promptText").GetString()?.Contains(expectedPromptTextFragment, StringComparison.Ordinal) == true)
                    {
                        return prompt;
                    }
                }
            }

            await Task.Delay(100);
        }

        var finalResponse = await client.GetAsync("/api/human/prompts");
        var finalJson = finalResponse.IsSuccessStatusCode ? await finalResponse.Content.ReadAsStringAsync() : $"status {(int)finalResponse.StatusCode}";
        throw new Xunit.Sdk.XunitException($"Human prompt containing '{expectedPromptTextFragment}' was not observed in time. Prompts={finalJson}");
    }

    private static async Task<JsonElement> WaitForHumanPromptStatusAsync(HttpClient client, string promptId, string expectedStatus)
    {
        for (var attempt = 0; attempt < 60; attempt++)
        {
            var response = await client.GetAsync($"/api/human/prompts/{promptId}");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (string.Equals(json.GetProperty("status").GetString(), expectedStatus, StringComparison.Ordinal))
            {
                return json;
            }

            await Task.Delay(100);
        }

        var finalResponse = await client.GetAsync($"/api/human/prompts/{promptId}");
        var finalJson = finalResponse.IsSuccessStatusCode ? await finalResponse.Content.ReadAsStringAsync() : $"status {(int)finalResponse.StatusCode}";
        throw new Xunit.Sdk.XunitException($"Human prompt '{promptId}' did not reach status '{expectedStatus}'. Prompt={finalJson}");
    }

    private void RemoveActorAddressRegistration(ActorAddress address)
    {
        Assert.NotNull(_factory);
        var runtime = _factory!.Services.GetRequiredService<RuntimeCompositionRoot>();
        var resolverField = typeof(RuntimeCompositionRoot).GetField("_resolver", BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.NotNull(resolverField);
        var resolver = resolverField!.GetValue(runtime);
        Assert.NotNull(resolver);

        var actorsField = resolver!.GetType().GetField("_actors", BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.NotNull(actorsField);
        var actors = actorsField!.GetValue(resolver);
        Assert.NotNull(actors);

        var removeMethod = actors!.GetType().GetMethod("Remove", new[] { typeof(ActorAddress) });
        Assert.NotNull(removeMethod);
        _ = removeMethod!.Invoke(actors, new object[] { address });
    }
}