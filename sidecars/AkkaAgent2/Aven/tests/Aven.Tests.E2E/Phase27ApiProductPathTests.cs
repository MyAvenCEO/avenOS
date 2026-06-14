using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Aven.Api.Runtime;
using Aven.Capabilities.Contracts.Models;
using Aven.Capabilities.Clients;

namespace Aven.Tests.E2E;

public sealed partial class Phase27ApiProductPathTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase27-{Guid.NewGuid():N}.sqlite");
    private readonly string _traceDatabasePath = Path.Combine(Path.GetTempPath(), $"aven-phase27-trace-{Guid.NewGuid():N}.sqlite");
    private WebApplicationFactory<Program>? _factory;
    private StubLlmServer? _stubLlmServer;

    [Fact]
    public async Task Api_CreateAgent_UploadInvoice_AndRouteMessage_ProducesMetadataThroughActorOwnedPath()
    {
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_invoice_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new { content = new object[] { new { type = "output_text", text = AccountingInvoiceStructuredOutput("INV-500", 125.50m) } } }
            },
            usage = new { input_tokens = 12, output_tokens = 8, total_tokens = 20 }
        });
        var client = CreateClient(providerResponses, out var capture);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-api",
            roleName = "accountant",
            displayName = "Accountant",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf", "image" },
            primarySchemas = new[] { "schema://accounting/invoice@3" },
            routingDescription = "Routes invoices and statements"
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var artifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");

        var acceptedResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase27-invoice",
            incomingItemRef = artifactId,
            inputType = "pdf",
            attachmentRefs = new[] { artifactId },
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        });

        Assert.Equal(HttpStatusCode.OK, acceptedResponse.StatusCode);
        Assert.True(capture.RequestBodies.Count >= 1 || capture.FileUploadCount > 0, $"Expected visible LLM/provider traffic but saw Requests={capture.RequestBodies.Count}, Files={capture.FileUploadCount}");

        var acceptedJson = await acceptedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("corr-api-phase27-invoice", acceptedJson.GetProperty("correlationId").GetProperty("value").GetString());
        Assert.True(acceptedJson.TryGetProperty("routingAttemptId", out var routingAttemptId));
        Assert.False(acceptedJson.GetProperty("idempotent").GetBoolean());
        Assert.Equal("Accepted", acceptedJson.GetProperty("delivery").GetProperty("status").GetString());
        Assert.True(
            string.Equals(acceptedJson.GetProperty("decision").GetProperty("attempt").GetProperty("status").GetString(), "Routed", StringComparison.Ordinal),
            $"Invoice routing did not produce Routed. Response={acceptedJson}; Requests={capture.RequestBodies.Count}; Files={capture.FileUploadCount}; Bodies=[{string.Join(" || ", capture.RequestBodies)}]");

        var agentJson = await WaitForAgentSettledAsync(client, "agent-accountant-api", "invoice_recorded", expectedRoleMemoryFragment: "INV-500");
        Assert.Equal("Idle", agentJson.GetProperty("status").GetString());
        Assert.Equal("invoice_recorded", agentJson.GetProperty("lastRunSummary").GetString());

        var artifactResponse = await client.GetAsync($"/api/artifacts/{artifactId}");
        Assert.Equal(HttpStatusCode.OK, artifactResponse.StatusCode);
        var artifactJson = await artifactResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("upload", artifactJson.GetProperty("sourceKind").GetString());

        var metadataJson = await WaitForMetadataAsync(client, "schema://accounting/invoice@3", "INV-500");
        Assert.True(metadataJson.ValueKind == JsonValueKind.Array);
        Assert.Contains(metadataJson.EnumerateArray(), x =>
            x.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://accounting/invoice@3"
            && x.GetProperty("json").GetString()!.Contains("INV-500", StringComparison.Ordinal));

        var correlationTrace = await WaitForDebugTimelineAsync(client, "/api/debug/correlations/corr-api-phase27-invoice?limit=200", "MetadataRecordCreated");
        var invoiceEvents = correlationTrace.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("eventType").GetString()).ToArray();
        Assert.Contains("MessageSubmitted", invoiceEvents);
        Assert.Contains("RoutingCommitted", invoiceEvents);
        Assert.Contains("DeliveryAcceptedByRecipient", invoiceEvents);
        Assert.Contains("WorkItemOpened", invoiceEvents);
        Assert.Contains("MetadataRecordCreated", invoiceEvents);

        var routingResponse = await client.GetAsync($"/api/debug/routing/{routingAttemptId.GetProperty("value").GetString()}?limit=200");
        Assert.Equal(HttpStatusCode.OK, routingResponse.StatusCode);
        var routingJson = await routingResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("routing_attempt", routingJson.GetProperty("subject").GetProperty("type").GetString());
        Assert.Contains(
            routingJson.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("eventType").GetString()),
            eventType => string.Equals(eventType, "RoutingCommitted", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Api_ReusesIdempotentMessageSubmission()
    {
        var client = CreateClient(new Queue<object>(), out _);

        _ = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-idem",
            roleName = "accountant",
            displayName = "Accountant",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf" },
            primarySchemas = new[] { "schema://accounting/invoice@3" }
        });

        var payload = new
        {
            idempotencyKey = "api-phase27-idem",
            incomingItemRef = "incoming/invoice-200.pdf",
            inputType = "pdf",
            attachmentRefs = Array.Empty<string>(),
            contentSummary = "invoice pdf from vendor",
            proposedIntent = "accounting.invoice",
            proposedReason = "invoice upload",
            requiredSchemas = new[] { "schema://accounting/invoice@3" }
        };

        var first = await client.PostAsJsonAsync("/api/messages", payload);
        var second = await client.PostAsJsonAsync("/api/messages", payload);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        var firstJson = await first.Content.ReadFromJsonAsync<JsonElement>();
        var secondJson = await second.Content.ReadFromJsonAsync<JsonElement>();

        Assert.False(firstJson.GetProperty("idempotent").GetBoolean());
        Assert.True(secondJson.GetProperty("idempotent").GetBoolean());
        Assert.Equal("corr-api-phase27-idem", firstJson.GetProperty("correlationId").GetProperty("value").GetString());
        Assert.Equal("corr-api-phase27-idem", secondJson.GetProperty("correlationId").GetProperty("value").GetString());
        Assert.Equal(
            firstJson.GetProperty("routingAttemptId").GetProperty("value").GetString(),
            secondJson.GetProperty("routingAttemptId").GetProperty("value").GetString());
    }

    [Fact]
    public async Task Api_RejectsUnsupportedInputType_WithoutRecordingSubmissionSideEffects()
    {
        var client = CreateClient(new Queue<object>(), out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-accountant-unsupported-input",
            roleName = "accountant",
            displayName = "Accountant",
            objective = "Handle invoices and statements",
            responsibilityScope = "Accounting documents",
            acceptedInputTypes = new[] { "pdf" },
            primarySchemas = new[] { "schema://accounting/invoice@3" }
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var rejectedResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase27-unsupported-input-type",
            incomingItemRef = "blob:artifact-123",
            inputType = "spreadsheet",
            attachmentRefs = Array.Empty<string>(),
            contentSummary = "spreadsheet upload",
            proposedIntent = "accounting.invoice",
            proposedReason = "submitted via api",
            requiredSchemas = Array.Empty<string>()
        });

        Assert.Equal(HttpStatusCode.BadRequest, rejectedResponse.StatusCode);
        var rejectedJson = await rejectedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("unsupported_input_type", rejectedJson.GetProperty("error").GetProperty("code").GetString());

        var debugRoutingResponse = await client.GetAsync("/api/debug/routing/route-api-phase27-unsupported-input-type?limit=50");
        Assert.Equal(HttpStatusCode.OK, debugRoutingResponse.StatusCode);
        var debugRoutingJson = await debugRoutingResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(debugRoutingJson.GetProperty("items").EnumerateArray());

        var agentJson = await client.GetFromJsonAsync<JsonElement>("/api/agents/agent-accountant-unsupported-input");
        Assert.Equal("Created", agentJson.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, agentJson.GetProperty("lastRunSummary").ValueKind);
    }

    [Fact]
    public async Task Api_CreateContractWatcher_UploadContract_AndScheduleReminder_ThroughRoleDrivenPath()
    {
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5).ToString("O");
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_contract_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new
                        {
                            type = "output_text",
                            text = $"{{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"{dueAt}\",\"reminderText\":\"Review lease renewal\",\"renewalTermJson\":{{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"{dueAt}\"}}}}"
                        }
                    }
                }
            },
            usage = new { input_tokens = 15, output_tokens = 12, total_tokens = 27 }
        });
        var client = CreateClient(providerResponses, out var capture);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-contract-watcher-api",
            roleName = "contract_watcher",
            displayName = "Contract Watcher",
            objective = "Track contract renewals and reminders",
            responsibilityScope = "Contracts and lease renewals",
            acceptedInputTypes = new[] { "pdf", "image" },
            primarySchemas = new[] { "schema://contracts/contract-summary@1", "schema://contracts/renewal-term@1" },
            routingDescription = "Routes contracts and lease renewals"
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var artifactId = await UploadFixtureAsync(client, "contract-de.pdf", "application/pdf");

        var acceptedResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase27-contract",
            incomingItemRef = artifactId,
            inputType = "pdf",
            attachmentRefs = new[] { artifactId },
            contentSummary = "lease agreement with renewal date",
            proposedIntent = "contracts.renewal",
            proposedReason = "contract upload",
            requiredSchemas = new[] { "schema://contracts/contract-summary@1" }
        });

        Assert.Equal(HttpStatusCode.OK, acceptedResponse.StatusCode);
        var acceptedJson = await acceptedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("corr-api-phase27-contract", acceptedJson.GetProperty("correlationId").GetProperty("value").GetString());

        var agentJson = await WaitForAgentStateAsync(client, "agent-contract-watcher-api", "Idle");
        Assert.Equal("Idle", agentJson.GetProperty("status").GetString());
        Assert.Equal("reminder_scheduled", agentJson.GetProperty("lastRunSummary").GetString());

        var metadataJson = await WaitForMetadataAsync(client, "schema://contracts/contract-summary@1", "LEASE-2027");
        Assert.Contains(metadataJson.EnumerateArray(), x =>
            x.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://contracts/contract-summary@1"
            && x.GetProperty("json").GetString()!.Contains("LEASE-2027", StringComparison.Ordinal));

        var contractTrace = await WaitForDebugTimelineAsync(client, "/api/debug/correlations/corr-api-phase27-contract?limit=300", "MetadataRecordCreated", "ScheduleRegistered");
        var contractEvents = contractTrace.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("eventType").GetString()).ToArray();
        Assert.Contains("MessageSubmitted", contractEvents);
        Assert.Contains("RoutingCommitted", contractEvents);
        Assert.Contains("DeliveryAcceptedByRecipient", contractEvents);
        Assert.Contains("WorkItemOpened", contractEvents);
        Assert.Contains("MetadataRecordCreated", contractEvents);
        Assert.Contains("ScheduleRegistered", contractEvents);

        var scheduleJson = await WaitForScheduleAsync(client, "schedule-contract-LEASE-2027");
        Assert.Equal("schedule-contract-LEASE-2027", scheduleJson.GetProperty("scheduleId").GetString());
        Assert.Equal(0, scheduleJson.GetProperty("fireCount").GetInt32());

        var fireResponse = await client.PostAsync("/api/schedules/schedule-contract-LEASE-2027/check-due", content: null);
        Assert.Equal(HttpStatusCode.OK, fireResponse.StatusCode);

        var firedScheduleJson = await WaitForScheduleFireCountAsync(client, "schedule-contract-LEASE-2027", 1);
        Assert.Equal(1, firedScheduleJson.GetProperty("fireCount").GetInt32());

        var reminderMetadataJson = await WaitForMetadataAsync(client, "schema://contracts/reminder-fired@1", "Review lease renewal");
        Assert.Equal(1, CountMetadataMatches(reminderMetadataJson, "schema://contracts/reminder-fired@1", "LEASE-2027"));

        var secondFireResponse = await client.PostAsync("/api/schedules/schedule-contract-LEASE-2027/check-due", content: null);
        Assert.Equal(HttpStatusCode.OK, secondFireResponse.StatusCode);

        var secondFireJson = await secondFireResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("already_processed", secondFireJson.GetProperty("reason").GetString());

        await AssertMetadataCountAsync(client, "schema://contracts/reminder-fired@1", "LEASE-2027", 1);
    }

    [Fact]
    public async Task Api_CreateResearchWatch_UploadDocument_AndScheduledDigest_Flows_Back_Into_AgentOwned_ProductPath()
    {
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5).ToString("O");
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_research_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new
                        {
                            type = "output_text",
                            text = $"{{\"paperId\":\"PAPER-42\",\"topic\":\"battery chemistry\",\"summary\":\"New findings on cycle stability.\",\"digestDueAt\":\"{dueAt}\"}}"
                        }
                    }
                }
            },
            usage = new { input_tokens = 14, output_tokens = 11, total_tokens = 25 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_research_2",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new
                        {
                            type = "output_text",
                            text = "{\"paperId\":\"PAPER-42\",\"topic\":\"battery chemistry\",\"digest\":\"Weekly digest covering recent battery chemistry updates.\"}"
                        }
                    }
                }
            },
            usage = new { input_tokens = 16, output_tokens = 13, total_tokens = 29 }
        });
        var client = CreateClient(providerResponses, out var capture);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-research-watch-api",
            roleName = "research_watch",
            displayName = "Research Watch",
            objective = "Track research papers and recurring digests",
            responsibilityScope = "Research papers and weekly digests",
            acceptedInputTypes = new[] { "pdf", "image", "text" },
            primarySchemas = new[] { "schema://research/document-summary@1", "schema://research/digest@1" },
            routingDescription = "Routes research documents and recurring digests"
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var artifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");

        var acceptedResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase27-research",
            incomingItemRef = artifactId,
            inputType = "pdf",
            attachmentRefs = new[] { artifactId },
            contentSummary = "research paper pdf on battery chemistry",
            proposedIntent = "research.paper",
            proposedReason = "research upload",
            requiredSchemas = new[] { "schema://research/document-summary@1" }
        });

        Assert.Equal(HttpStatusCode.OK, acceptedResponse.StatusCode);
        var acceptedJson = await acceptedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("corr-api-phase27-research", acceptedJson.GetProperty("correlationId").GetProperty("value").GetString());

        JsonElement summaryMetadataJson;
        try
        {
            summaryMetadataJson = await WaitForMetadataAsync(client, "schema://research/document-summary@1", "PAPER-42", "agent-research-watch-api", client);
        }
        catch (Exception ex)
        {
            throw new Xunit.Sdk.XunitException($"{ex.Message} ProviderRequests={capture.RequestBodies.Count}; FileUploads={capture.FileUploadCount}; Bodies=[{string.Join(" || ", capture.RequestBodies)}]");
        }
        Assert.Contains(summaryMetadataJson.EnumerateArray(), x =>
            x.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://research/document-summary@1"
            && x.GetProperty("json").GetString()!.Contains("battery chemistry", StringComparison.Ordinal));

        var scheduleJson = await WaitForScheduleAsync(client, "schedule-research-PAPER-42");
        Assert.Equal("schedule-research-PAPER-42", scheduleJson.GetProperty("scheduleId").GetString());
        Assert.Equal(0, scheduleJson.GetProperty("fireCount").GetInt32());

        var initialAgentJson = await WaitForAgentStateAsync(client, "agent-research-watch-api", "Idle");
        Assert.Equal("digest_scheduled", initialAgentJson.GetProperty("lastRunSummary").GetString());

        var fireResponse = await client.PostAsync("/api/schedules/schedule-research-PAPER-42/check-due", content: null);
        Assert.Equal(HttpStatusCode.OK, fireResponse.StatusCode);

        var firedScheduleJson = await WaitForScheduleFireCountAsync(client, "schedule-research-PAPER-42", 1);
        Assert.Equal(1, firedScheduleJson.GetProperty("fireCount").GetInt32());

        var digestMetadataJson = await WaitForMetadataAsync(client, "schema://research/digest@1", "Weekly digest covering recent battery chemistry updates.", "agent-research-watch-api", client);
        Assert.Contains(digestMetadataJson.EnumerateArray(), x =>
            x.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://research/digest@1"
            && x.GetProperty("json").GetString()!.Contains("battery chemistry", StringComparison.Ordinal));

        var finalAgentJson = await WaitForAgentStateAsync(client, "agent-research-watch-api", "Idle");
        Assert.Equal("research_digest_generated", finalAgentJson.GetProperty("lastRunSummary").GetString());

        var flushResponse = await client.PostAsync("/api/debug/flush", content: null);
        Assert.Equal(HttpStatusCode.OK, flushResponse.StatusCode);

        var debugHealth = await client.GetAsync("/api/debug/health");
        Assert.Equal(HttpStatusCode.OK, debugHealth.StatusCode);
        var healthJson = await debugHealth.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("healthy", healthJson.GetProperty("status").GetString());

        var correlationTrace = await WaitForDebugTimelineAsync(client, "/api/debug/correlations/corr-api-phase27-research?limit=500", "MetadataRecordCreated");
        var debugEvents = correlationTrace.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("eventType").GetString()).ToArray();
        Assert.Contains("MessageSubmitted", debugEvents);
        Assert.Contains("RoutingCommitted", debugEvents);
        Assert.Contains("DeliveryAcceptedByRecipient", debugEvents);
        Assert.Contains("WorkItemOpened", debugEvents);
        Assert.Contains("ScheduleRegistered", debugEvents);
        Assert.Contains("ScheduleOccurrenceRecorded", debugEvents);
        Assert.Contains("MetadataRecordCreated", debugEvents);

        var correlationLinks = correlationTrace.GetProperty("links").EnumerateArray().ToArray();
        Assert.Contains(correlationLinks, link =>
            link.GetProperty("from").GetProperty("type").GetString() == "correlation"
            && link.GetProperty("to").GetProperty("type").GetString() == "schedule"
            && link.GetProperty("to").GetProperty("id").GetString() == "schedule-research-PAPER-42"
            && link.GetProperty("type").GetString() == "includes");
        var initialLlmRequestId = BuildLlmRequestId(
            "agent/agent-research-watch-api",
            "research-extract-claim-route-api-phase27-research-agent-research-watch-api",
            "llm.generate");
        var digestLlmRequestId = BuildLlmRequestId(
            "agent/agent-research-watch-api",
            $"research-digest-PAPER-42-{DateTimeOffset.Parse(dueAt).UtcTicks}",
            "llm.generate");

        await AssertLlmTraceAsync(client, initialLlmRequestId);
        await AssertLlmTraceAsync(client, digestLlmRequestId);

        var scheduleTrace = await WaitForDebugTimelineAsync(client, "/api/debug/schedules/schedule-research-PAPER-42/timeline?limit=200", "ScheduleOccurrenceRecorded");
        var scheduleEvents = scheduleTrace.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("eventType").GetString()).ToArray();
        Assert.Contains("ScheduleRegistered", scheduleEvents);
        Assert.Contains("ScheduleOccurrenceRecorded", scheduleEvents);
        var scheduleLinks = scheduleTrace.GetProperty("links").EnumerateArray().ToArray();
        Assert.Contains(scheduleLinks, link =>
            ((link.GetProperty("from").GetProperty("type").GetString() == "schedule"
              && link.GetProperty("from").GetProperty("id").GetString() == "schedule-research-PAPER-42"
              && link.GetProperty("to").GetProperty("type").GetString() == "schedule_occurrence")
             || (link.GetProperty("to").GetProperty("type").GetString() == "schedule"
                 && link.GetProperty("to").GetProperty("id").GetString() == "schedule-research-PAPER-42"
                 && link.GetProperty("from").GetProperty("type").GetString() == "schedule_occurrence"))
            && link.GetProperty("type").GetString() == "recorded_occurrence");

        var stuckResponse = await client.GetAsync("/api/debug/stuck?olderThanSeconds=60");
        Assert.Equal(HttpStatusCode.OK, stuckResponse.StatusCode);
        var stuckJson = await stuckResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Array, stuckJson.ValueKind);
        Assert.Empty(stuckJson.EnumerateArray());
    }

    [Fact]
    public async Task Api_CreateResearchWatch_ScheduledDigest_WithInvalidDigestJson_DoesNotCreateDigestMetadata()
    {
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5).ToString("O");
        var providerResponses = new Queue<object>();
        providerResponses.Enqueue(new
        {
            id = "resp_research_schema_fail_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new
                        {
                            type = "output_text",
                            text = $"{{\"paperId\":\"PAPER-99\",\"topic\":\"solid state batteries\",\"summary\":\"Initial paper ingestion summary.\",\"digestDueAt\":\"{dueAt}\"}}"
                        }
                    }
                }
            },
            usage = new { input_tokens = 14, output_tokens = 11, total_tokens = 25 }
        });
        providerResponses.Enqueue(new
        {
            id = "resp_research_schema_fail_2",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new
                        {
                            type = "output_text",
                            text = "{\"paperId\":\"PAPER-99\",\"topic\":\"solid state batteries\"}"
                        }
                    }
                }
            },
            usage = new { input_tokens = 16, output_tokens = 7, total_tokens = 23 }
        });

        var client = CreateClient(providerResponses, out var capture);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-research-watch-schema-fail",
            roleName = "research_watch",
            displayName = "Research Watch",
            objective = "Track research papers and recurring digests",
            responsibilityScope = "Research papers and weekly digests",
            acceptedInputTypes = new[] { "pdf", "image", "text" },
            primarySchemas = new[] { "schema://research/document-summary@1", "schema://research/digest@1" },
            routingDescription = "Routes research documents and recurring digests"
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var artifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");

        var acceptedResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase27-research-schema-fail",
            incomingItemRef = artifactId,
            inputType = "pdf",
            attachmentRefs = new[] { artifactId },
            contentSummary = "research paper pdf on solid state batteries",
            proposedIntent = "research.paper",
            proposedReason = "research upload",
            requiredSchemas = new[] { "schema://research/document-summary@1" }
        });

        Assert.Equal(HttpStatusCode.OK, acceptedResponse.StatusCode);
        var acceptedJson = await acceptedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("corr-api-phase27-research-schema-fail", acceptedJson.GetProperty("correlationId").GetProperty("value").GetString());

        JsonElement summaryMetadataJson;
        try
        {
            summaryMetadataJson = await WaitForMetadataAsync(client, "schema://research/document-summary@1", "PAPER-99", "agent-research-watch-schema-fail", client);
        }
        catch (Exception ex)
        {
            throw new Xunit.Sdk.XunitException($"{ex.Message} ProviderRequests={capture.RequestBodies.Count}; FileUploads={capture.FileUploadCount}; Bodies=[{string.Join(" || ", capture.RequestBodies)}]");
        }
        Assert.Contains(summaryMetadataJson.EnumerateArray(), x =>
            x.GetProperty("schemaRef").GetProperty("value").GetString() == "schema://research/document-summary@1"
            && x.GetProperty("json").GetString()!.Contains("solid state batteries", StringComparison.Ordinal));

        var scheduleJson = await WaitForScheduleAsync(client, "schedule-research-PAPER-99");
        Assert.Equal(0, scheduleJson.GetProperty("fireCount").GetInt32());

        var initialAgentJson = await WaitForAgentStateAsync(client, "agent-research-watch-schema-fail", "Idle");
        Assert.Equal("digest_scheduled", initialAgentJson.GetProperty("lastRunSummary").GetString());

        var fireResponse = await client.PostAsync("/api/schedules/schedule-research-PAPER-99/check-due", content: null);
        Assert.Equal(HttpStatusCode.OK, fireResponse.StatusCode);

        var firedScheduleJson = await WaitForScheduleFireCountAsync(client, "schedule-research-PAPER-99", 1);
        Assert.Equal(1, firedScheduleJson.GetProperty("fireCount").GetInt32());

        await AssertNoMetadataAsync(client, "schema://research/digest@1", "PAPER-99");

        var agentJson = await WaitForAgentQuiescedAsync(client, "agent-research-watch-schema-fail", "Failed");
        Assert.Equal("Failed", agentJson.GetProperty("status").GetString());
        Assert.NotEqual("research_digest_generated", agentJson.GetProperty("lastRunSummary").GetString());

        Assert.True(capture.RequestBodies.Count >= 2, $"Expected at least two provider requests but saw {capture.RequestBodies.Count}.");
    }

    [Fact]
    public async Task Api_CreateResearchWatch_RestartAfterScheduleRegistration_ThenFireDigest_ProducesDigestExactlyOnce()
    {
        var dueAt = DateTimeOffset.UtcNow.AddMinutes(-5).ToString("O");
        var initialResponses = new Queue<object>();
        initialResponses.Enqueue(new
        {
            id = "resp_research_restart_1",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new
                        {
                            type = "output_text",
                            text = $"{{\"paperId\":\"PAPER-RESTART\",\"topic\":\"electrolyte stability\",\"summary\":\"Paper ingested before restart.\",\"digestDueAt\":\"{dueAt}\"}}"
                        }
                    }
                }
            },
            usage = new { input_tokens = 14, output_tokens = 11, total_tokens = 25 }
        });

        var client = CreateClient(initialResponses, out _);

        var createAgentResponse = await client.PostAsJsonAsync("/api/agents", new
        {
            roleAgentId = "agent-research-watch-restart",
            roleName = "research_watch",
            displayName = "Research Watch",
            objective = "Track research papers and recurring digests",
            responsibilityScope = "Research papers and weekly digests",
            acceptedInputTypes = new[] { "pdf", "image", "text" },
            primarySchemas = new[] { "schema://research/document-summary@1", "schema://research/digest@1" },
            routingDescription = "Routes research documents and recurring digests"
        });

        Assert.Equal(HttpStatusCode.Created, createAgentResponse.StatusCode);

        var artifactId = await UploadFixtureAsync(client, "invoice-en.pdf", "application/pdf");
        var acceptedResponse = await client.PostAsJsonAsync("/api/messages", new
        {
            idempotencyKey = "api-phase27-research-restart",
            incomingItemRef = artifactId,
            inputType = "pdf",
            attachmentRefs = new[] { artifactId },
            contentSummary = "research paper pdf on electrolyte stability",
            proposedIntent = "research.paper",
            proposedReason = "research upload",
            requiredSchemas = new[] { "schema://research/document-summary@1" }
        });

        Assert.Equal(HttpStatusCode.OK, acceptedResponse.StatusCode);
        var acceptedJson = await acceptedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("corr-api-phase27-research-restart", acceptedJson.GetProperty("correlationId").GetProperty("value").GetString());
        try
        {
            await WaitForMetadataAsync(client, "schema://research/document-summary@1", "PAPER-RESTART", "agent-research-watch-restart", client);
        }
        catch (Exception ex)
        {
            throw new Xunit.Sdk.XunitException($"{ex.Message} InitialRequests={initialResponses.Count}; ActiveProviderBaseUrl={_stubLlmServer?.BaseUrl};");
        }
        await WaitForScheduleAsync(client, "schedule-research-PAPER-RESTART");

        var initialAgentJson = await WaitForAgentStateAsync(client, "agent-research-watch-restart", "Idle");
        Assert.Equal("digest_scheduled", initialAgentJson.GetProperty("lastRunSummary").GetString());

        await DisposeRuntimeAsync(deleteDatabase: false);

        var restartResponses = new Queue<object>();
        restartResponses.Enqueue(new
        {
            id = "resp_research_restart_2",
            status = "completed",
            model = "gpt-4.1",
            output = new object[]
            {
                new
                {
                    content = new object[]
                    {
                        new
                        {
                            type = "output_text",
                            text = "{\"paperId\":\"PAPER-RESTART\",\"topic\":\"electrolyte stability\",\"digest\":\"Restart-safe digest for electrolyte stability updates.\"}"
                        }
                    }
                }
            },
            usage = new { input_tokens = 16, output_tokens = 13, total_tokens = 29 }
        });

        var (restartClient, restartCapture) = await RecreateClientAsync(restartResponses);

        var fireResponse = await restartClient.PostAsync("/api/schedules/schedule-research-PAPER-RESTART/check-due", content: null);
        Assert.Equal(HttpStatusCode.OK, fireResponse.StatusCode);

        var firedScheduleJson = await WaitForScheduleFireCountAsync(restartClient, "schedule-research-PAPER-RESTART", 1);
        Assert.Equal(1, firedScheduleJson.GetProperty("fireCount").GetInt32());

        var digestMetadataJson = await WaitForMetadataAsync(restartClient, "schema://research/digest@1", "Restart-safe digest for electrolyte stability updates.");
        Assert.Equal(1, CountMetadataMatches(digestMetadataJson, "schema://research/digest@1", "PAPER-RESTART"));

        var secondFireResponse = await restartClient.PostAsync("/api/schedules/schedule-research-PAPER-RESTART/check-due", content: null);
        Assert.Equal(HttpStatusCode.OK, secondFireResponse.StatusCode);
        var secondFireJson = await secondFireResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("not_due", secondFireJson.GetProperty("reason").GetString());

        await AssertMetadataCountAsync(restartClient, "schema://research/digest@1", "PAPER-RESTART", 1);
        Assert.True(restartCapture.RequestBodies.Count >= 1, $"Expected at least one provider request after restart but saw {restartCapture.RequestBodies.Count}.");
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        await DisposeRuntimeAsync(deleteDatabase: true);
    }

    private HttpClient CreateClient(Queue<object> providerResponses, out StubProviderCapture capture, IReadOnlyDictionary<string, string?>? extraConfiguration = null)
    {
        if (_stubLlmServer is not null)
        {
            _stubLlmServer.DisposeAsync().AsTask().GetAwaiter().GetResult();
            _stubLlmServer = null;
        }

        if (_factory is not null)
        {
            _factory.Dispose();
            _factory = null;
        }

        capture = new StubProviderCapture();
        _stubLlmServer = new StubLlmServer(providerResponses, capture);
        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("https_port", "0");
                builder.ConfigureAppConfiguration((_, configurationBuilder) =>
                {
                    var config = new Dictionary<string, string?>
                    {
                        ["Aven:Persistence:SqlitePath"] = _databasePath,
                        ["Aven:Trace:SqlitePath"] = _traceDatabasePath,
                        ["Aven:Llm:Provider"] = "openai",
                        ["Aven:Llm:BaseUrl"] = _stubLlmServer.BaseUrl,
                        ["Aven:Llm:ApiKey"] = "stub-token",
                        ["Aven:Llm:Model"] = "gpt-4.1",
                        ["Aven:Llm:Protocol"] = "openai.responses",
                        ["Aven:Llm:Enabled"] = "true"
                    };
                    if (extraConfiguration is not null)
                    {
                        foreach (var pair in extraConfiguration)
                        {
                            config[pair.Key] = pair.Value;
                        }
                    }

                    configurationBuilder.AddInMemoryCollection(config);
                });
            });

        return _factory.CreateClient();
    }

    private async Task<(HttpClient Client, StubProviderCapture Capture)> RecreateClientAsync(Queue<object> providerResponses)
    {
        await DisposeRuntimeAsync(deleteDatabase: false);
        var capture = new StubProviderCapture();
        _stubLlmServer = new StubLlmServer(providerResponses, capture);
        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("https_port", "0");
                builder.ConfigureAppConfiguration((_, configurationBuilder) =>
                {
                    configurationBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["Aven:Persistence:SqlitePath"] = _databasePath,
                        ["Aven:Trace:SqlitePath"] = _traceDatabasePath,
                        ["Aven:Llm:Provider"] = "openai",
                        ["Aven:Llm:BaseUrl"] = _stubLlmServer.BaseUrl,
                        ["Aven:Llm:ApiKey"] = "stub-token",
                        ["Aven:Llm:Model"] = "gpt-4.1",
                        ["Aven:Llm:Protocol"] = "openai.responses",
                        ["Aven:Llm:Enabled"] = "true"
                    });
                });
            });

        return (_factory.CreateClient(), capture);
    }

    private CapabilityAdmissionClient GetCapabilityAuthority()
    {
        Assert.NotNull(_factory);
        return _factory!.Services.GetRequiredService<RuntimeCompositionRoot>()
            .GetType()
            .GetField("_capabilityAuthority", BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(_factory.Services.GetRequiredService<RuntimeCompositionRoot>()) as CapabilityAdmissionClient
            ?? throw new InvalidOperationException("Capability authority not available.");
    }

    private static CapabilityAdmissionRequest CreateCapabilityRequest(string capabilityId, string holderValue, string targetValue, string messageType) =>
        new(
            new CapabilityId(capabilityId),
            new OperationKey(new ActorAddress(holderValue, "local"), new RequestId($"req-{capabilityId}-{messageType}"), messageType),
            new ActorAddress(targetValue, "local"),
            messageType,
            DateTimeOffset.UtcNow);

    private async Task DisposeRuntimeAsync(bool deleteDatabase)
    {
        if (_stubLlmServer is not null)
        {
            await _stubLlmServer.DisposeAsync();
            _stubLlmServer = null;
        }

        if (_factory is not null)
        {
            await _factory.DisposeAsync();
            _factory = null;
        }

        if (deleteDatabase && File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }
        if (deleteDatabase && File.Exists(_traceDatabasePath))
        {
            File.Delete(_traceDatabasePath);
        }
    }

    private static async Task<string> UploadFixtureAsync(HttpClient client, string fixtureName, string mimeType)
    {
        using var multipart = new MultipartFormDataContent();
        var content = new ByteArrayContent(await LoadFixtureBytesAsync(fixtureName));
        content.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType);
        multipart.Add(content, "file", fixtureName);

        var uploadResponse = await client.PostAsync("/api/artifacts", multipart);
        Assert.Equal(HttpStatusCode.Created, uploadResponse.StatusCode);
        var uploadJson = await uploadResponse.Content.ReadFromJsonAsync<JsonElement>();
        var artifactId = uploadJson.GetProperty("artifactId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(artifactId));
        return artifactId!;
    }

    private static async Task<byte[]> LoadFixtureBytesAsync(string fixtureName)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "TestFixtures", fixtureName);
        Assert.True(File.Exists(path), $"Fixture file was not found: {path}");
        return await File.ReadAllBytesAsync(path);
    }

    private static async Task<JsonElement> WaitForAgentStateAsync(HttpClient client, string agentId, string expectedStatus, string? expectedLastRunSummary = null)
    {
        string? lastJson = null;
        for (var attempt = 0; attempt < 100; attempt++)
        {
            var response = await client.GetAsync($"/api/agents/{agentId}");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            lastJson = json.GetRawText();
            var statusMatches = string.Equals(json.GetProperty("status").GetString(), expectedStatus, StringComparison.Ordinal);
            var summaryMatches = expectedLastRunSummary is null
                || string.Equals(json.GetProperty("lastRunSummary").GetString(), expectedLastRunSummary, StringComparison.Ordinal);
            if (statusMatches && summaryMatches)
            {
                return json;
            }

            await Task.Delay(100);
        }

        var expectedDescription = expectedLastRunSummary is null
            ? $"status '{expectedStatus}'"
            : $"status '{expectedStatus}' with lastRunSummary '{expectedLastRunSummary}'";
        throw new Xunit.Sdk.XunitException($"Agent '{agentId}' did not reach expected {expectedDescription}. LastState={lastJson}");
    }

    private static async Task<JsonElement> WaitForAgentSettledAsync(
        HttpClient client,
        string agentId,
        string expectedLastRunSummary,
        string? expectedRoleMemoryFragment = null)
    {
        string? lastJson = null;

        for (var attempt = 0; attempt < 120; attempt++)
        {
            var response = await client.GetAsync($"/api/agents/{agentId}");
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            lastJson = json.GetRawText();

            var statusMatches =
                json.TryGetProperty("status", out var status)
                && status.GetString() == "Idle";

            var summaryMatches =
                json.TryGetProperty("lastRunSummary", out var summary)
                && summary.GetString() == expectedLastRunSummary;

            var noOpenWork =
                !json.TryGetProperty("openWorkItems", out var openWork)
                || openWork.GetArrayLength() == 0;

            var noActiveRuns =
                !json.TryGetProperty("activeRuns", out var activeRuns)
                || activeRuns.GetArrayLength() == 0;

            var noPendingOps =
                !json.TryGetProperty("pendingOperations", out var pendingOps)
                || pendingOps.GetArrayLength() == 0;

            var memoryMatches =
                expectedRoleMemoryFragment is null
                || (json.TryGetProperty("roleMemoryJson", out var memory)
                    && memory.ValueKind == JsonValueKind.String
                    && memory.GetString() is { } memoryText
                    && memoryText.Contains(expectedRoleMemoryFragment, StringComparison.Ordinal));

            if (statusMatches && summaryMatches && noOpenWork && noActiveRuns && noPendingOps && memoryMatches)
            {
                return json;
            }

            await Task.Delay(100);
        }

        throw new Xunit.Sdk.XunitException(
            $"Agent '{agentId}' did not settle. Expected summary={expectedLastRunSummary}, memory fragment={expectedRoleMemoryFragment}. Last state: {lastJson}");
    }

    private static async Task<JsonElement> WaitForAgentQuiescedAsync(
        HttpClient client,
        string agentId,
        string expectedStatus,
        string? expectedLastRunSummary = null,
        bool requireNoOpenWorkItems = false)
    {
        string? lastJson = null;

        for (var attempt = 0; attempt < 120; attempt++)
        {
            var response = await client.GetAsync($"/api/agents/{agentId}");
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            lastJson = json.GetRawText();

            var statusMatches =
                json.TryGetProperty("status", out var status)
                && string.Equals(status.GetString(), expectedStatus, StringComparison.Ordinal);

            var summaryMatches =
                expectedLastRunSummary is null
                || (json.TryGetProperty("lastRunSummary", out var summary)
                    && string.Equals(summary.GetString(), expectedLastRunSummary, StringComparison.Ordinal));

            var noActiveRuns =
                !json.TryGetProperty("activeRuns", out var activeRuns)
                || activeRuns.GetArrayLength() == 0;

            var noPendingOps =
                !json.TryGetProperty("pendingOperations", out var pendingOps)
                || pendingOps.GetArrayLength() == 0;

            var noOpenWork =
                !requireNoOpenWorkItems
                || !json.TryGetProperty("openWorkItems", out var openWork)
                || openWork.GetArrayLength() == 0;

            if (statusMatches && summaryMatches && noActiveRuns && noPendingOps && noOpenWork)
            {
                return json;
            }

            await Task.Delay(100);
        }

        throw new Xunit.Sdk.XunitException(
            $"Agent '{agentId}' did not quiesce. Expected status={expectedStatus}, summary={expectedLastRunSummary}, requireNoOpenWorkItems={requireNoOpenWorkItems}. Last state: {lastJson}");
    }

    private static async Task<JsonElement> WaitForMetadataAsync(HttpClient client, string schemaRef, string expectedJsonFragment, string? debugRoleAgentId = null, HttpClient? debugClient = null)
    {
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var metadataResponse = await client.GetAsync("/api/metadata");
            metadataResponse.EnsureSuccessStatusCode();
            var metadataJson = await metadataResponse.Content.ReadFromJsonAsync<JsonElement>();
            if (metadataJson.ValueKind == JsonValueKind.Array
                && metadataJson.EnumerateArray().Any(x =>
                    x.GetProperty("schemaRef").GetProperty("value").GetString() == schemaRef
                    && x.GetProperty("json").GetString()!.Contains(expectedJsonFragment, StringComparison.Ordinal)))
            {
                return metadataJson;
            }

            await Task.Delay(100);
        }

        string? agentDebug = null;
        if (!string.IsNullOrWhiteSpace(debugRoleAgentId) && debugClient is not null)
        {
            var agentResponse = await debugClient.GetAsync($"/api/agents/{debugRoleAgentId}");
            if (agentResponse.IsSuccessStatusCode)
            {
                agentDebug = await agentResponse.Content.ReadAsStringAsync();
            }
        }

        var metadataDumpResponse = await client.GetAsync("/api/metadata");
        var metadataDump = metadataDumpResponse.IsSuccessStatusCode
            ? await metadataDumpResponse.Content.ReadAsStringAsync()
            : $"metadata endpoint status {(int)metadataDumpResponse.StatusCode}";
        throw new Xunit.Sdk.XunitException($"Metadata for schema '{schemaRef}' containing '{expectedJsonFragment}' was not observed in time. Agent={agentDebug ?? "n/a"}; Metadata={metadataDump}");
    }

    private static async Task<JsonElement> WaitForScheduleAsync(HttpClient client, string scheduleId)
    {
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var response = await client.GetAsync($"/api/schedules/{scheduleId}");
            if (response.StatusCode == HttpStatusCode.OK)
            {
                return await response.Content.ReadFromJsonAsync<JsonElement>();
            }

            await Task.Delay(100);
        }

        throw new Xunit.Sdk.XunitException($"Schedule '{scheduleId}' was not observed in time.");
    }

    private static async Task<JsonElement> WaitForScheduleFireCountAsync(HttpClient client, string scheduleId, int expectedFireCount)
    {
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var json = await WaitForScheduleAsync(client, scheduleId);
            if (json.GetProperty("fireCount").GetInt32() == expectedFireCount)
            {
                return json;
            }

            await Task.Delay(100);
        }

        var finalResponse = await client.GetAsync($"/api/schedules/{scheduleId}");
        var finalJson = finalResponse.IsSuccessStatusCode
            ? await finalResponse.Content.ReadAsStringAsync()
            : $"schedule endpoint status {(int)finalResponse.StatusCode}";
        throw new Xunit.Sdk.XunitException($"Schedule '{scheduleId}' did not reach fireCount={expectedFireCount} in time. FinalSchedule={finalJson}");
    }

    private static async Task<JsonElement> WaitForDebugTimelineAsync(HttpClient client, string path, params string[] expectedEventTypes)
    {
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var response = await client.GetAsync(path);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            var observed = json.GetProperty("items")
                .EnumerateArray()
                .Select(x => x.GetProperty("eventType").GetString())
                .Where(static x => x is not null)
                .ToHashSet(StringComparer.Ordinal)!;
            if (expectedEventTypes.All(expected => observed.Contains(expected)))
            {
                return json;
            }

            await Task.Delay(100);
        }

        var finalResponse = await client.GetAsync(path);
        var finalJson = finalResponse.IsSuccessStatusCode ? await finalResponse.Content.ReadAsStringAsync() : $"debug status {(int)finalResponse.StatusCode}";
        throw new Xunit.Sdk.XunitException($"Debug trace '{path}' did not contain all expected events [{string.Join(", ", expectedEventTypes)}]. Trace={finalJson}");
    }

    // Produces a fully-populated invoice "essence" (extraction) document. The accounting role validates
    // the LLM's structured output against the invoice-extraction@1 schema, whose structured-output form
    // requires every declared property, so each object below lists all of its fields explicitly.
    private static string AccountingInvoiceStructuredOutput(string invoiceNumber, decimal invoiceTotal, string vendorName = "Example GmbH") =>
        JsonSerializer.Serialize(new
        {
            header = new
            {
                document_kind = "invoice",
                letter_date = (string?)null,
                due_date = (string?)null,
                referenced_invoice_numbers = Array.Empty<string>(),
                issue_date = "2026-06-01",
                invoice_number = invoiceNumber,
                order_number = (string?)null,
                customer_number = (string?)null,
                reference_entries = Array.Empty<object>(),
                currency = "EUR"
            },
            vendor = AccountingVendorParty(vendorName),
            buyer = AccountingBuyerParty("Example Buyer"),
            payment_instructions = (string?)null,
            totals = new { subtotal = invoiceTotal, tax_breakdown = Array.Empty<object>(), tax_total = 0m, invoice_total = invoiceTotal },
            payments = Array.Empty<object>(),
            total_outstanding = invoiceTotal,
            statements = new[]
            {
                new
                {
                    section_title = (string?)null,
                    service_period = (string?)null,
                    line_items = Array.Empty<object>(),
                    line_groups = Array.Empty<object>(),
                    service_period_normalized = (object?)null
                }
            }
        });

    // The invoice vendor with every field the extraction schema declares for a vendor; nullable nested
    // objects (bank, org_public_record) are left null so their sub-properties are not required.
    private static object AccountingVendorParty(string name) => new
    {
        identity_id = (string?)null,
        name,
        contact_name = (string?)null,
        contact_identity_id = (string?)null,
        street = (string?)null,
        postal_code = (string?)null,
        city = (string?)null,
        country = (string?)null,
        email = (string?)null,
        phone = (string?)null,
        tax_id = (string?)null,
        bank = (object?)null,
        banking_accounts = Array.Empty<object>(),
        org_public_record = (object?)null
    };

    // The invoice buyer with every field the extraction schema declares for a buyer (no bank /
    // org_public_record; those are vendor-only in the essence schema).
    private static object AccountingBuyerParty(string name) => new
    {
        identity_id = (string?)null,
        name,
        contact_name = (string?)null,
        contact_identity_id = (string?)null,
        street = (string?)null,
        postal_code = (string?)null,
        city = (string?)null,
        country = (string?)null,
        email = (string?)null,
        phone = (string?)null,
        tax_id = (string?)null,
        banking_accounts = Array.Empty<object>()
    };

    // Produces a fully-populated bank-statement "essence" (extraction) document. As with invoices, the
    // account-statement-extraction@1 schema requires every declared property in its structured-output
    // form, so each object lists all of its fields explicitly.
    private static string AccountingStatementStructuredOutput(string statementId, string transactionReference, decimal amount = -125.50m) =>
        JsonSerializer.Serialize(new
        {
            statement_kind = "periodic_account_statement",
            statement_id = statementId,
            statement_issue_date = "2026-06-02",
            currency = "EUR",
            period_start = "2026-06-01",
            period_end = "2026-06-30",
            payment_due_date = (string?)null,
            opening_balance = 1000m,
            closing_balance = 874.50m,
            account_holder = AccountingStatementHolder("Example Buyer"),
            institution = AccountingStatementHolder("Example Bank"),
            account_overview = new
            {
                branch_name = (string?)null,
                iban = "DE02120300000000202051",
                bic = "BYLADEM1001",
                account_number = "202051",
                domestic_bank_code = (string?)null,
                product_name = "Business Account",
                card_last_four = (string?)null
            },
            transactions = new[]
            {
                new
                {
                    booking_date = "2026-06-03",
                    booking_date_as_printed = "03.06.2026",
                    value_date = "2026-06-03",
                    description = transactionReference,
                    title = (string?)null,
                    counterparty_name = "Example GmbH",
                    transaction_id = $"TX-{statementId}",
                    amount = amount,
                    fx_surcharge_eur = (decimal?)null,
                    foreign_exchange_fee_percent = (decimal?)null,
                    original_amount = (decimal?)null,
                    original_currency = (string?)null,
                    exchange_rate = (string?)null,
                    balance_after = 874.50m
                }
            },
            notes = (string?)null
        });

    // An account holder / institution party with every field the statement extraction schema declares.
    private static object AccountingStatementHolder(string name) => new
    {
        identity_id = (string?)null,
        name,
        contact_name = (string?)null,
        contact_identity_id = (string?)null,
        street = (string?)null,
        postal_code = (string?)null,
        city = (string?)null,
        country = (string?)null,
        email = (string?)null,
        phone = (string?)null,
        tax_id = (string?)null
    };

    private static async Task AssertNoMetadataAsync(HttpClient client, string schemaRef, string unexpectedJsonFragment, int attempts = 15, int delayMs = 100)
    {
        for (var attempt = 0; attempt < attempts; attempt++)
        {
            var metadataResponse = await client.GetAsync("/api/metadata");
            metadataResponse.EnsureSuccessStatusCode();
            var metadataJson = await metadataResponse.Content.ReadFromJsonAsync<JsonElement>();
            var found = metadataJson.ValueKind == JsonValueKind.Array
                && metadataJson.EnumerateArray().Any(x =>
                    x.GetProperty("schemaRef").GetProperty("value").GetString() == schemaRef
                    && x.GetProperty("json").GetString()!.Contains(unexpectedJsonFragment, StringComparison.Ordinal));

            Assert.False(found, $"Unexpected metadata for schema '{schemaRef}' containing '{unexpectedJsonFragment}' was created: {metadataJson}");
            await Task.Delay(delayMs);
        }
    }

    private static async Task AssertMetadataCountAsync(HttpClient client, string schemaRef, string expectedJsonFragment, int expectedCount, int attempts = 20, int delayMs = 100)
    {
        for (var attempt = 0; attempt < attempts; attempt++)
        {
            var metadataResponse = await client.GetAsync("/api/metadata");
            metadataResponse.EnsureSuccessStatusCode();
            var metadataJson = await metadataResponse.Content.ReadFromJsonAsync<JsonElement>();
            if (CountMetadataMatches(metadataJson, schemaRef, expectedJsonFragment) == expectedCount)
            {
                return;
            }

            await Task.Delay(delayMs);
        }

        var finalResponse = await client.GetAsync("/api/metadata");
        var finalJson = finalResponse.IsSuccessStatusCode
            ? await finalResponse.Content.ReadAsStringAsync()
            : $"metadata endpoint status {(int)finalResponse.StatusCode}";
        throw new Xunit.Sdk.XunitException($"Metadata for schema '{schemaRef}' containing '{expectedJsonFragment}' did not settle at count={expectedCount}. Metadata={finalJson}");
    }

    private static string BuildLlmRequestId(string caller, string requestId, string operationType)
    {
        static string Sanitize(string value)
        {
            Span<char> buffer = stackalloc char[value.Length];
            var index = 0;
            foreach (var ch in value)
            {
                buffer[index++] = char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-';
            }

            return new string(buffer[..index]);
        }

        return $"llm-{Sanitize(caller)}-{Sanitize(requestId)}-{Sanitize(operationType)}";
    }

    private static async Task AssertLlmTraceAsync(HttpClient client, string llmRequestId)
    {
        var llmTrace = await WaitForDebugEntityAsync(client, $"/api/debug/llm/{Uri.EscapeDataString(llmRequestId)}", "LlmRequestSucceeded");
        Assert.Equal("llm_request", llmTrace.GetProperty("subject").GetProperty("type").GetString());
        Assert.Equal(llmRequestId, llmTrace.GetProperty("subject").GetProperty("id").GetString());
        var llmEvents = llmTrace.GetProperty("timeline").GetProperty("items").EnumerateArray().Select(x => x.GetProperty("eventType").GetString()).ToArray();
        Assert.Contains("LlmRequestRegistered", llmEvents);
        Assert.Contains("LlmRequestSucceeded", llmEvents);
        var llmLinks = llmTrace.GetProperty("timeline").GetProperty("links").EnumerateArray().ToArray();
        Assert.Contains(llmLinks, link =>
            link.GetProperty("from").GetProperty("type").GetString() == "operation"
            && link.GetProperty("to").GetProperty("type").GetString() == "llm_request"
            && link.GetProperty("to").GetProperty("id").GetString() == llmRequestId
            && link.GetProperty("type").GetString() == "requested_llm");
    }

    private static async Task<JsonElement> WaitForDebugEntityAsync(HttpClient client, string path, string expectedEventType)
    {
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var response = await client.GetAsync(path);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (json.GetProperty("timeline").GetProperty("items").EnumerateArray().Any(x => x.GetProperty("eventType").GetString() == expectedEventType))
            {
                return json;
            }

            await Task.Delay(100);
        }

        var finalResponse = await client.GetAsync(path);
        var finalJson = finalResponse.IsSuccessStatusCode ? await finalResponse.Content.ReadAsStringAsync() : $"debug status {(int)finalResponse.StatusCode}";
        throw new Xunit.Sdk.XunitException($"Debug entity '{path}' did not contain '{expectedEventType}'. Trace={finalJson}");
    }

    private static int CountMetadataMatches(JsonElement metadataJson, string schemaRef, string expectedJsonFragment) =>
        metadataJson.ValueKind != JsonValueKind.Array
            ? 0
            : metadataJson.EnumerateArray().Count(x =>
                x.GetProperty("schemaRef").GetProperty("value").GetString() == schemaRef
                && x.GetProperty("json").GetString()!.Contains(expectedJsonFragment, StringComparison.Ordinal));

    private sealed class StubProviderCapture
    {
        public int FileUploadCount { get; set; }
        public List<string> RequestBodies { get; } = new();
    }

    private sealed record DelayedProviderResponse(int DelayMs, object Payload);

    private sealed class StubLlmServer : IAsyncDisposable
    {
        private readonly HttpListener _listener;
        private readonly Queue<object> _providerResponses;
        private readonly StubProviderCapture _capture;
        private readonly CancellationTokenSource _cts = new();
        private readonly Task _serveLoop;

        public StubLlmServer(Queue<object> providerResponses, StubProviderCapture capture)
        {
            _providerResponses = providerResponses;
            _capture = capture;
            var port = GetFreePort();
            BaseUrl = $"http://127.0.0.1:{port}";
            _listener = new HttpListener();
            _listener.Prefixes.Add($"{BaseUrl}/");
            _listener.Start();
            _serveLoop = Task.Run(ServeAsync);
        }

        public string BaseUrl { get; }

        public async ValueTask DisposeAsync()
        {
            _cts.Cancel();
            _listener.Stop();
            try
            {
                await _serveLoop;
            }
            catch
            {
                // ignore shutdown exceptions
            }

            _listener.Close();
            _cts.Dispose();
        }

        private async Task ServeAsync()
        {
            while (!_cts.IsCancellationRequested)
            {
                HttpListenerContext context;
                try
                {
                    context = await _listener.GetContextAsync();
                }
                catch when (_cts.IsCancellationRequested)
                {
                    break;
                }
                catch (HttpListenerException) when (_cts.IsCancellationRequested)
                {
                    break;
                }

                await HandleAsync(context);
            }
        }

        private async Task HandleAsync(HttpListenerContext context)
        {
            var path = context.Request.Url?.AbsolutePath ?? string.Empty;
            if (string.Equals(path, "/files", StringComparison.Ordinal))
            {
                _capture.FileUploadCount++;
                await WriteJsonAsync(context.Response, new { id = "file-openai-phase27" });
                return;
            }

            if (string.Equals(path, "/responses", StringComparison.Ordinal))
            {
                using var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8);
                var requestBody = await reader.ReadToEndAsync();
                _capture.RequestBodies.Add(requestBody);
                var payload = TryBuildRoutingResponse(requestBody)
                    ?? (_providerResponses.Count > 0
                    ? _providerResponses.Dequeue()
                    : new
                    {
                        id = "resp_default",
                        status = "completed",
                        model = "gpt-4.1",
                        output = new object[]
                        {
                            new { content = new object[] { new { type = "output_text", text = "{}" } } }
                        },
                        usage = new { input_tokens = 1, output_tokens = 1, total_tokens = 2 }
                    });

                if (payload is DelayedProviderResponse delayed)
                {
                    await Task.Delay(delayed.DelayMs);
                    payload = delayed.Payload;
                }

                await WriteJsonAsync(context.Response, payload);
                return;
            }

            context.Response.StatusCode = (int)HttpStatusCode.NotFound;
            context.Response.Close();
        }

        private static async Task WriteJsonAsync(HttpListenerResponse response, object payload)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
            response.StatusCode = (int)HttpStatusCode.OK;
            response.ContentType = "application/json";
            response.ContentLength64 = bytes.Length;
            await response.OutputStream.WriteAsync(bytes);
            response.Close();
        }

        private static object? TryBuildRoutingResponse(string requestBody)
        {
            using var document = JsonDocument.Parse(requestBody);
            if (!document.RootElement.TryGetProperty("text", out var textElement)
                || !textElement.TryGetProperty("format", out var formatElement)
                || !formatElement.TryGetProperty("name", out var nameElement)
                || !string.Equals(nameElement.GetString(), "schema_routing_decision_v1", StringComparison.Ordinal))
            {
                return null;
            }

            var agentId = "agent-unknown";
            if (document.RootElement.TryGetProperty("input", out var inputElement)
                && inputElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in inputElement.EnumerateArray())
                {
                    if (!item.TryGetProperty("content", out var contentElement) || contentElement.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (var content in contentElement.EnumerateArray())
                    {
                        if (!content.TryGetProperty("text", out var embeddedText) || embeddedText.ValueKind != JsonValueKind.String)
                        {
                            continue;
                        }

                        var text = embeddedText.GetString();
                        if (string.IsNullOrWhiteSpace(text) || !text.Contains("\"candidates\"", StringComparison.Ordinal))
                        {
                            continue;
                        }

                        using var embeddedDoc = JsonDocument.Parse(text);
                        if (embeddedDoc.RootElement.TryGetProperty("candidates", out var candidates)
                            && candidates.ValueKind == JsonValueKind.Array
                            && candidates.GetArrayLength() > 0)
                        {
                            var first = candidates[0];
                            if (first.TryGetProperty("roleAgentId", out var agentIdElement) && agentIdElement.ValueKind == JsonValueKind.String)
                            {
                                agentId = agentIdElement.GetString() ?? agentId;
                            }
                        }
                    }
                }
            }

            return new
            {
                id = $"route_{agentId}",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = $"{{\"decision\":\"route\",\"candidateRoleAgentIds\":[\"{agentId}\"],\"reason\":\"Stubbed routing decision for {agentId}.\"}}" } } }
                },
                usage = new { input_tokens = 10, output_tokens = 8, total_tokens = 18 }
            };
        }

        private static int GetFreePort()
        {
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }
    }
}