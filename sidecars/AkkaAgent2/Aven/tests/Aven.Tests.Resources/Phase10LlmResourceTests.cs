using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.Contracts.Messaging;
using Aven.Contracts.Protocol;
using Aven.Resources.Artifacts;
using Aven.Resources.Llm;
using Aven.Resources.Llm.Gateways;
using Aven.Resources.Runtime.Gateways;
using Aven.Resources.Runtime.Inbox;
using System.Net;
using System.Text;
using System.Text.Json;
using ToolkitArtifactRef = Aven.Toolkit.Artifacts.ArtifactRef;
using ToolkitBlobRef = Aven.Toolkit.Artifacts.BlobRef;
using ToolkitFileSystemArtifactBlobStore = Aven.Toolkit.Artifacts.FileSystemArtifactBlobStore;
using ToolkitArtifactId = Aven.Toolkit.Core.Identifiers.ArtifactId;
using ToolkitArtifactRevisionId = Aven.Toolkit.Core.Identifiers.ArtifactRevisionId;

namespace Aven.Tests.Resources;

public sealed class Phase10LlmResourceTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase10-{Guid.NewGuid():N}.sqlite");
    private readonly string _blobRoot = Path.Combine(Path.GetTempPath(), $"aven-phase10-blobs-{Guid.NewGuid():N}");

    [Fact]
    public async Task TextRequest_Succeeds_WithFakeProvider()
    {
        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-text",
                new LlmModelCapabilities("fake-text", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Hello fake provider") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "hello back"));

            var actor = CreateWorker(system, "llm-text", request);
            var reply = await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10));

            var success = Assert.IsType<LlmRequestSucceededReply>(reply);
            Assert.Equal("hello back", success.Response.Text);
            Assert.Equal(15, success.Response.Usage.TotalTokens);
            Assert.Equal("stop", success.Response.FinishReason);
        });
    }

    [Fact]
    public async Task PdfArtifactRequest_IsRejected_WhenModelCapabilityMissing()
    {
        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-pdf",
                new LlmModelCapabilities("fake-no-pdf", true, false, true, true, true, false),
                new LlmInputBlock[] { new ArtifactInputBlock(LlmBlockKind.DocumentArtifact, new ArtifactId("artifact/pdf"), "application/pdf") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "ignored"));

            var actor = CreateWorker(system, "llm-pdf", request);
            var reply = await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10));

            var rejected = Assert.IsType<LlmRequestRejectedReply>(reply);
            Assert.Equal("unsupported_document_artifact", rejected.Error.Code);
        });
    }

    [Fact]
    public async Task StrictSchemaOutput_Validates()
    {
        await WithSystem(async system =>
        {
            var contract = InvoiceContract(strict: true);
            var request = CreateRequest(
                "req-structured-strict",
                new LlmModelCapabilities("fake-strict", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Extract invoice fields") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.StructuredSuccess, StructuredJson: "{\"invoiceNumber\":\"INV-1\"}"),
                contract);

            var actor = CreateWorker(system, "llm-structured-strict", request);
            var reply = await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10));

            var success = Assert.IsType<LlmRequestSucceededReply>(reply);
            Assert.True(success.Response.StructuredOutputValidated);
            Assert.Equal(contract.SchemaRef, success.Response.SchemaRef);
            Assert.Empty(success.Response.Degradations);
        });
    }

    [Fact]
    public async Task PromptOnlyFallback_IsMarkedDegraded()
    {
        await WithSystem(async system =>
        {
            var contract = InvoiceContract(strict: true);
            var request = CreateRequest(
                "req-structured-fallback",
                new LlmModelCapabilities("fake-prompt-only", true, true, true, false, true, false),
                new LlmInputBlock[] { new TextInputBlock("Extract invoice fields") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.StructuredSuccess, StructuredJson: "{\"invoiceNumber\":\"INV-2\"}"),
                contract);

            var actor = CreateWorker(system, "llm-structured-fallback", request);
            var reply = await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10));

            var success = Assert.IsType<LlmRequestSucceededReply>(reply);
            Assert.Single(success.Response.Degradations);
            Assert.Equal("prompt_only_structured_output", success.Response.Degradations[0].Code);
            Assert.True(success.Response.StructuredOutputValidated);
        });
    }

    [Fact]
    public async Task Refusal_And_SafetyBlock_AreRepresentedExplicitly()
    {
        await WithSystem(async system =>
        {
            var refusalRequest = CreateRequest(
                "req-refusal",
                new LlmModelCapabilities("fake-refusal", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Do something unsafe") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.Refusal, Text: "I refuse that request."));

            var safetyRequest = CreateRequest(
                "req-safety",
                new LlmModelCapabilities("fake-safety", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Unsafe content") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.SafetyBlock, Text: "Blocked by safety rules."));

            var refusalActor = CreateWorker(system, "llm-refusal", refusalRequest);
            var safetyActor = CreateWorker(system, "llm-safety", safetyRequest);

            var refusalReply = Assert.IsType<LlmRequestSucceededReply>(await refusalActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            var safetyReply = Assert.IsType<LlmRequestSucceededReply>(await safetyActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.Equal("I refuse that request.", refusalReply.Response.Refusal);
            Assert.Equal("refusal", refusalReply.Response.FinishReason);
            Assert.Equal("Blocked by safety rules.", safetyReply.Response.SafetyBlock);
            Assert.Equal("safety_block", safetyReply.Response.FinishReason);
        });
    }

    [Fact]
    public async Task UnknownExternalCallRecovery_FailsExplicitly_WhenProviderCannotRecover()
    {
        var request = CreateRequest(
            "req-recovery",
            new LlmModelCapabilities("fake-unknown", true, true, true, true, true, false),
            new LlmInputBlock[] { new TextInputBlock("Start and stay in flight") },
            new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.InFlightUnknown, RecoverableAfterRestart: false));

        await WithSystem(async system =>
        {
            var actor = CreateWorker(system, "llm-recovery", request);
            var initial = await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10));

            var failed = Assert.IsType<LlmRequestFailedReply>(initial);
            Assert.Equal("in_flight_started", failed.Error.Code);
        });

        await WithSystem(async system =>
        {
            var actor = CreateWorker(system, "llm-recovery", request);
            var state = await actor.Ask<LlmRequestState>(new LlmInspect(), TimeSpan.FromSeconds(10));

            Assert.Equal(LlmRequestStatus.Failed, state.Status);
            Assert.NotNull(state.Error);
            Assert.Equal("recovery_incomplete", state.Error!.Code);
        });
    }

    [Fact]
    public async Task ParentReconstructedWorker_RecoversStateAndReconstructsTerminalReplies()
    {
        var successRequest = CreateRequest(
            "req-parent-reconstruct-success",
            new LlmModelCapabilities("fake-parent-success", true, true, true, true, true, false),
            new LlmInputBlock[] { new TextInputBlock("Original prompt must come from parent reconstruction") },
            new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "parent reconstructed success"));
        var rejectedRequest = CreateRequest(
            "req-parent-reconstruct-rejected",
            new LlmModelCapabilities("fake-parent-rejected-no-pdf", true, false, true, true, true, false),
            new LlmInputBlock[] { new ArtifactInputBlock(LlmBlockKind.DocumentArtifact, new ArtifactId("artifact/rejected-parent"), "application/pdf") },
            new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));
        var failedRequest = CreateRequest(
            "req-parent-reconstruct-failed",
            new LlmModelCapabilities("fake-parent-failed", true, true, true, true, true, false),
            new LlmInputBlock[] { new TextInputBlock("Provider will fail after external call starts") },
            new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

        await WithSystem(async system =>
        {
            var successActor = CreateWorker(system, "llm-parent-reconstruct-success", successRequest);
            var success = Assert.IsType<LlmRequestSucceededReply>(await successActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("parent reconstructed success", success.Response.Text);

            var rejectedActor = CreateWorker(system, "llm-parent-reconstruct-rejected", rejectedRequest);
            var rejected = Assert.IsType<LlmRequestRejectedReply>(await rejectedActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("unsupported_document_artifact", rejected.Error.Code);

            var failedActor = CreateWorker(system, "llm-parent-reconstruct-failed", failedRequest, new AlwaysFailingLlmProvider());
            var failed = Assert.IsType<LlmRequestFailedReply>(await failedActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("provider_terminal_failure", failed.Error.Code);
        });

        await WithSystem(async system =>
        {
            var successActor = CreateWorker(system, "llm-parent-reconstruct-success", successRequest);
            var successState = await successActor.Ask<LlmRequestState>(new LlmInspect(), TimeSpan.FromSeconds(10));
            Assert.Equal(LlmRequestStatus.Succeeded, successState.Status);
            Assert.True(successState.ExternalCallStarted);
            Assert.Equal(successRequest.Key, successState.Request.Key);
            Assert.Equal(successRequest.Input, successState.Request.Input);
            var successReply = Assert.IsType<LlmRequestSucceededReply>(await successActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("parent reconstructed success", successReply.Response.Text);

            var rejectedActor = CreateWorker(system, "llm-parent-reconstruct-rejected", rejectedRequest);
            var rejectedState = await rejectedActor.Ask<LlmRequestState>(new LlmInspect(), TimeSpan.FromSeconds(10));
            Assert.Equal(LlmRequestStatus.Rejected, rejectedState.Status);
            Assert.False(rejectedState.ExternalCallStarted);
            Assert.Equal(rejectedRequest.Input, rejectedState.Request.Input);
            var rejectedReply = Assert.IsType<LlmRequestRejectedReply>(await rejectedActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("unsupported_document_artifact", rejectedReply.Error.Code);

            var failedActor = CreateWorker(system, "llm-parent-reconstruct-failed", failedRequest, new AlwaysFailingLlmProvider());
            var failedState = await failedActor.Ask<LlmRequestState>(new LlmInspect(), TimeSpan.FromSeconds(10));
            Assert.Equal(LlmRequestStatus.Failed, failedState.Status);
            Assert.True(failedState.ExternalCallStarted);
            Assert.Equal(failedRequest.Input, failedState.Request.Input);
            var failedReply = Assert.IsType<LlmRequestFailedReply>(await failedActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("provider_terminal_failure", failedReply.Error.Code);
        });
    }

    [Fact]
    public async Task HttpProvider_TextRequest_UsesRealAdapterPath_AndReturnsCanonicalResponse()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-text-model",
                text = "stub text response",
                finishReason = "stop",
                usage = new { promptTokens = 12, completionTokens = 7, totalTokens = 19, cost = 0.42m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            });
        });

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-http-text",
                new LlmModelCapabilities("stub-text-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Hello over HTTP") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-http-text", request, provider);
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.Equal("stub-http", reply.Response.Provider);
            Assert.Equal("stub-text-model", reply.Response.Model);
            Assert.Equal("stub text response", reply.Response.Text);
            Assert.Equal(19, reply.Response.Usage.TotalTokens);
            Assert.NotNull(capturedRequest);
            Assert.Equal(HttpMethod.Post, capturedRequest!.Method);
            Assert.EndsWith("/responses", capturedRequest.RequestUri, StringComparison.Ordinal);
            Assert.Equal("Bearer", capturedRequest.AuthorizationScheme);
            Assert.Equal("secret-token", capturedRequest.AuthorizationParameter);

            using var json = JsonDocument.Parse(capturedRequest.Body);
            Assert.Equal("stub-http", json.RootElement.GetProperty("provider").GetString());
            Assert.Equal("stub-text-model", json.RootElement.GetProperty("model").GetString());
            Assert.Equal("text", json.RootElement.GetProperty("input")[0].GetProperty("kind").GetString());
            Assert.Equal("Hello over HTTP", json.RootElement.GetProperty("input")[0].GetProperty("text").GetString());
        });
    }

    [Fact]
    public async Task HttpProvider_StructuredOutput_RequestAndResponse_WorkThroughStubAdapter()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-structured-model",
                structuredJson = new { invoiceNumber = "INV-HTTP-1" },
                finishReason = "structured_stop",
                usage = new { promptTokens = 10, completionTokens = 5, totalTokens = 15, cost = 0.11m },
                citations = new[] { "page-1" },
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            });
        });

        await WithSystem(async system =>
        {
            var contract = InvoiceContract(strict: true);
            var request = CreateRequest(
                "req-http-structured",
                new LlmModelCapabilities("stub-structured-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Extract invoice fields") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.StructuredSuccess, StructuredJson: "{\"invoiceNumber\":\"unused\"}"),
                contract);

            var actor = CreateWorker(system, "llm-http-structured", request, provider);
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.True(reply.Response.StructuredOutputValidated);
            Assert.Equal(contract.SchemaRef, reply.Response.SchemaRef);
            Assert.Equal("{" + "\"invoiceNumber\":\"INV-HTTP-1\"}", reply.Response.StructuredJson);

            using var json = JsonDocument.Parse(capturedRequest!.Body);
            Assert.Equal(contract.SchemaRef.Value, json.RootElement.GetProperty("structuredOutput").GetProperty("schemaRef").GetString());
            Assert.True(json.RootElement.GetProperty("structuredOutput").GetProperty("strict").GetBoolean());
        });
    }

    [Fact]
    public async Task HttpProvider_OpenAiResponses_TextRequest_MapsNativePayload_AndParsesResponse()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_123",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new
                    {
                        content = new object[]
                        {
                            new { type = "output_text", text = "hello from openai" }
                        }
                    }
                },
                usage = new
                {
                    input_tokens = 12,
                    output_tokens = 5,
                    total_tokens = 17
                }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-openai-text",
                new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Hello native OpenAI") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-openai-text", request, provider);
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.Equal("openai", reply.Response.Provider);
            Assert.Equal("gpt-4.1", reply.Response.Model);
            Assert.Equal("hello from openai", reply.Response.Text);
            Assert.Equal(17, reply.Response.Usage.TotalTokens);
            Assert.NotNull(capturedRequest);
            Assert.EndsWith("/responses", capturedRequest!.RequestUri, StringComparison.Ordinal);

            using var json = JsonDocument.Parse(capturedRequest.Body);
            Assert.Equal("gpt-4.1", json.RootElement.GetProperty("model").GetString());
            Assert.Equal("user", json.RootElement.GetProperty("input")[0].GetProperty("role").GetString());
            Assert.Equal("input_text", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("type").GetString());
            Assert.Equal("Hello native OpenAI", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("text").GetString());
        });
    }

    [Fact]
    public async Task HttpProvider_OpenAiResponses_StructuredOutput_UsesJsonSchemaFormat_AndValidatesCanonicalResponse()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_456",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new
                    {
                        content = new object[]
                        {
                            new { type = "output_text", text = "{\"invoiceNumber\":\"INV-OAI-1\"}" }
                        }
                    }
                },
                usage = new
                {
                    input_tokens = 20,
                    output_tokens = 8,
                    total_tokens = 28
                }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var contract = InvoiceContract(strict: true);
            var request = CreateRequest(
                "req-openai-structured",
                new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Extract invoice fields") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.StructuredSuccess, StructuredJson: "unused"),
                contract);

            var actor = CreateWorker(system, "llm-openai-structured", request, provider);
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.True(reply.Response.StructuredOutputValidated);
            Assert.Equal(contract.SchemaRef, reply.Response.SchemaRef);
            Assert.Equal("{\"invoiceNumber\":\"INV-OAI-1\"}", reply.Response.StructuredJson);

            using var json = JsonDocument.Parse(capturedRequest!.Body);
            Assert.Equal("json_schema", json.RootElement.GetProperty("text").GetProperty("format").GetProperty("type").GetString());
            Assert.True(json.RootElement.GetProperty("text").GetProperty("format").GetProperty("strict").GetBoolean());
            _ = json.RootElement.GetProperty("text").GetProperty("format").GetProperty("schema");
        });
    }

    [Fact]
    public async Task HttpProvider_OpenAiResponses_ImageArtifact_MapsInputImageDataUrl()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_img",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = "image handled" } } }
                },
                usage = new { input_tokens = 4, output_tokens = 2, total_tokens = 6 }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-openai-image",
                new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false),
                new LlmInputBlock[]
                {
                    new ArtifactInputBlock(LlmBlockKind.ImageArtifact, new ArtifactId("artifact-image"), "image/png", "data:image/png;base64,AAEC")
                },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-openai-image", request, provider);
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.Equal("image handled", reply.Response.Text);
            using var json = JsonDocument.Parse(capturedRequest!.Body);
            Assert.Equal("input_image", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("type").GetString());
            Assert.Equal("data:image/png;base64,AAEC", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("image_url").GetString());
        });
    }

    [Fact]
    public async Task HttpProvider_OpenAiResponses_PdfArtifact_MapsInputFileDataUrl()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_pdf",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = "pdf handled" } } }
                },
                usage = new { input_tokens = 5, output_tokens = 2, total_tokens = 7 }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-openai-pdf",
                new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false),
                new LlmInputBlock[]
                {
                    new ArtifactInputBlock(LlmBlockKind.DocumentArtifact, new ArtifactId("artifact-pdf"), "application/pdf", "data:application/pdf;base64,JVBERi0x")
                },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-openai-pdf", request, provider);
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.Equal("pdf handled", reply.Response.Text);
            using var json = JsonDocument.Parse(capturedRequest!.Body);
            Assert.Equal("input_file", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("type").GetString());
            Assert.Equal("artifact-pdf.pdf", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("filename").GetString());
            Assert.Equal("data:application/pdf;base64,JVBERi0x", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("file_data").GetString());
        });
    }


    [Fact]
    public async Task LlmGateway_DirectStructuredGeneration_Succeeds()
    {
        await WithSystem(async system =>
        {
            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-direct-structured-success-schema")), "phase10-direct-structured-success-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var provider = new CountingLlmProvider("{\"invoiceNumber\":\"INV-DIRECT-1\"}");
            var pipeline = new LlmExtractionPipeline(system, provider, new SqliteArtifactStore($"Data Source={_databasePath}"), new ToolkitFileSystemArtifactBlobStore(_blobRoot), new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var authority = CreateStructuredGenerationAuthority();
            var gateway = system.ActorOf(Props.Create(() => new LlmGatewayActor(new LocalActorAddressRegistry(), schemaActor, pipeline, CreateInboxStore("llm-direct-structured-success"), authority)), "phase10-direct-structured-success");

            var reply = await gateway.Ask<LlmStructuredGenerationReply>(
                new LlmStructuredGenerationCommand(
                    new RequestId("routing-test/llm/1"),
                    new ActorAddress("api/routing", "local"),
                    new CorrelationId("corr-direct-structured-success"),
                    new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                    new LlmInputBlock[] { new TextInputBlock("Return invoice JSON") },
                    contract.SchemaRef,
                    "routing_decision",
                    new LlmReasoningOptions(true, "small"),
                    new LlmBudgetLimits(1m, 1000, 500),
                    new LlmSafetySettings(),
                    new CapabilityId("api-routing-llm-cap")),
                TimeSpan.FromSeconds(10));

            var success = Assert.IsType<LlmStructuredGenerationSucceeded>(reply);
            Assert.Equal("{\"invoiceNumber\":\"INV-DIRECT-1\"}", success.StructuredJson);
            Assert.Equal(1, provider.CallCount);
        });
    }

    [Fact]
    public async Task LlmGateway_DirectStructuredGeneration_RejectsMissingCapability_WithoutProviderCall()
    {
        await WithSystem(async system =>
        {
            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-direct-structured-capability-schema")), "phase10-direct-structured-capability-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var provider = new CountingLlmProvider("{\"invoiceNumber\":\"INV-DIRECT-2\"}");
            var pipeline = new LlmExtractionPipeline(system, provider, new SqliteArtifactStore($"Data Source={_databasePath}"), new ToolkitFileSystemArtifactBlobStore(_blobRoot), new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var authority = CreateStructuredGenerationAuthority();
            var gateway = system.ActorOf(Props.Create(() => new LlmGatewayActor(new LocalActorAddressRegistry(), schemaActor, pipeline, CreateInboxStore("llm-direct-structured-capability"), authority)), "phase10-direct-structured-capability");

            var reply = await gateway.Ask<LlmStructuredGenerationReply>(
                new LlmStructuredGenerationCommand(
                    new RequestId("routing-test/llm/2"),
                    new ActorAddress("api/routing", "local"),
                    new CorrelationId("corr-direct-structured-capability"),
                    new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                    new LlmInputBlock[] { new TextInputBlock("Return invoice JSON") },
                    contract.SchemaRef,
                    "routing_decision",
                    new LlmReasoningOptions(true, "small"),
                    new LlmBudgetLimits(1m, 1000, 500),
                    new LlmSafetySettings(),
                    null),
                TimeSpan.FromSeconds(10));

            var rejected = Assert.IsType<LlmStructuredGenerationRejected>(reply);
            Assert.Equal("capability_required", rejected.Error.Code);
            Assert.Equal(0, provider.CallCount);
        });
    }

    [Fact]
    public async Task LlmGateway_DirectStructuredGeneration_FailsSchemaValidation_AfterProviderExecution()
    {
        await WithSystem(async system =>
        {
            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-direct-structured-invalid-schema")), "phase10-direct-structured-invalid-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var provider = new CountingLlmProvider("{\"vendor\":\"Missing invoice number\"}");
            var pipeline = new LlmExtractionPipeline(system, provider, new SqliteArtifactStore($"Data Source={_databasePath}"), new ToolkitFileSystemArtifactBlobStore(_blobRoot), new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var authority = CreateStructuredGenerationAuthority();
            var gateway = system.ActorOf(Props.Create(() => new LlmGatewayActor(new LocalActorAddressRegistry(), schemaActor, pipeline, CreateInboxStore("llm-direct-structured-invalid"), authority)), "phase10-direct-structured-invalid");

            var reply = await gateway.Ask<LlmStructuredGenerationReply>(
                new LlmStructuredGenerationCommand(
                    new RequestId("routing-test/llm/3"),
                    new ActorAddress("api/routing", "local"),
                    new CorrelationId("corr-direct-structured-invalid"),
                    new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                    new LlmInputBlock[] { new TextInputBlock("Return invoice JSON") },
                    contract.SchemaRef,
                    "routing_decision",
                    new LlmReasoningOptions(true, "small"),
                    new LlmBudgetLimits(1m, 1000, 500),
                    new LlmSafetySettings(),
                    new CapabilityId("api-routing-llm-cap")),
                TimeSpan.FromSeconds(10));

            var failed = Assert.IsType<LlmStructuredGenerationFailed>(reply);
            Assert.Equal("structured_output_invalid", failed.Error.Code);
            Assert.Equal(1, provider.CallCount);
        });
    }

    [Fact]
    public async Task HttpProvider_Refusal_And_SafetyBlock_MapToCanonicalResponse()
    {
        var refusalProvider = CreateHttpProvider((_, _) => JsonResponse(new
        {
            provider = "stub-http",
            model = "stub-model",
            refusal = "I refuse.",
            finishReason = "refusal",
            usage = new { promptTokens = 1, completionTokens = 0, totalTokens = 1, cost = 0m },
            citations = Array.Empty<string>(),
            degradations = Array.Empty<object>(),
            toolCalls = Array.Empty<object>()
        }));

        var safetyProvider = CreateHttpProvider((_, _) => JsonResponse(new
        {
            provider = "stub-http",
            model = "stub-model",
            safetyBlock = "Blocked.",
            finishReason = "safety_block",
            usage = new { promptTokens = 1, completionTokens = 0, totalTokens = 1, cost = 0m },
            citations = Array.Empty<string>(),
            degradations = Array.Empty<object>(),
            toolCalls = Array.Empty<object>()
        }));

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-http-refusal",
                new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Unsafe") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var refusalActor = CreateWorker(system, "llm-http-refusal", request, refusalProvider);
            var refusal = Assert.IsType<LlmRequestSucceededReply>(await refusalActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("I refuse.", refusal.Response.Refusal);
            Assert.Equal("refusal", refusal.Response.FinishReason);
        });

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-http-safety",
                new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Unsafe") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var safetyActor = CreateWorker(system, "llm-http-safety", request, safetyProvider);
            var safety = Assert.IsType<LlmRequestSucceededReply>(await safetyActor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("Blocked.", safety.Response.SafetyBlock);
            Assert.Equal("safety_block", safety.Response.FinishReason);
        });
    }

    [Fact]
    public async Task HttpProvider_MapsToolResultInputBlock_ForStubAndOpenAiResponses()
    {
        CapturedHttpRequest? stubRequest = null;
        var stubProvider = CreateHttpProvider((request, _) =>
        {
            stubRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-model",
                text = "tool result handled",
                finishReason = "stop",
                usage = new { promptTokens = 3, completionTokens = 1, totalTokens = 4, cost = 0m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            });
        });

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-tool-result-stub",
                new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new ToolResultInputBlock("search_docs", "{\"ok\":true}") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-tool-result-stub", request, stubProvider);
            _ = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            using var json = JsonDocument.Parse(stubRequest!.Body);
            Assert.Equal("tool_result", json.RootElement.GetProperty("input")[0].GetProperty("kind").GetString());
            Assert.Equal("search_docs", json.RootElement.GetProperty("input")[0].GetProperty("toolName").GetString());
            Assert.Equal("{\"ok\":true}", json.RootElement.GetProperty("input")[0].GetProperty("resultJson").GetString());
        });

        CapturedHttpRequest? openAiRequest = null;
        var openAiProvider = CreateHttpProvider((request, _) =>
        {
            openAiRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_tool_result",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = "tool result handled" } } }
                },
                usage = new { input_tokens = 3, output_tokens = 1, total_tokens = 4 }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-tool-result-openai",
                new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false),
                new LlmInputBlock[] { new ToolResultInputBlock("search_docs", "{\"ok\":true}") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-tool-result-openai", request, openAiProvider);
            _ = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            using var json = JsonDocument.Parse(openAiRequest!.Body);
            Assert.Equal("user", json.RootElement.GetProperty("input")[0].GetProperty("role").GetString());
            Assert.Equal("input_text", json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("type").GetString());
            var text = json.RootElement.GetProperty("input")[0].GetProperty("content")[0].GetProperty("text").GetString();
            Assert.Contains("search_docs", text, StringComparison.Ordinal);
            Assert.Contains("{\"ok\":true}", text, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void HttpLlmProvider_UploadProviderFile_InvalidDataUrls_ThrowStableProviderException()
    {
        var provider = CreateHttpProvider((_, _) => throw new InvalidOperationException("should not send"), protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        var scenarios = new[]
        {
            "https://example.invalid/file.pdf",
            "data:application/pdf,plain-text",
            "data:application/pdf;base64,%%%super-secret%%%"
        };

        foreach (var inlineDataUrl in scenarios)
        {
            var descriptor = new ArtifactSourceDescriptor(
                new ToolkitArtifactRef(new ToolkitArtifactId("artifact-invalid"), new ToolkitArtifactRevisionId("revision-invalid")),
                "artifact-invalid.pdf",
                "application/pdf",
                new ToolkitBlobRef("sha256", "deadbeef", 4),
                InlineDataUrl: inlineDataUrl);

            var error = Assert.Throws<LlmProviderException>(() => provider.UploadProviderFile(descriptor, "test", "openai.responses.file_id"));
            Assert.Equal("provider_file_upload_invalid_data_url", error.Error.Code);
            Assert.DoesNotContain("super-secret", error.Error.Message, StringComparison.Ordinal);
            Assert.DoesNotContain(inlineDataUrl, error.Error.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task HttpProvider_Http429And500_ClassifyRetryability()
    {
        var tooManyRequestsProvider = CreateHttpProvider((_, _) => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
        {
            Content = new StringContent("slow down", Encoding.UTF8, "text/plain")
        });

        var serverErrorProvider = CreateHttpProvider((_, _) => new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("server exploded", Encoding.UTF8, "text/plain")
        });

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-http-429",
                new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Retryable") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-http-429", request, tooManyRequestsProvider);
            var failed = Assert.IsType<LlmRequestFailedReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("provider_rate_limited", failed.Error.Code);
            Assert.True(failed.Error.Retryable);
        });

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-http-500",
                new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Retryable") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-http-500", request, serverErrorProvider);
            var failed = Assert.IsType<LlmRequestFailedReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("provider_http_error", failed.Error.Code);
            Assert.True(failed.Error.Retryable);
        });
    }

    [Fact]
    public async Task MissingProviderConfiguration_ReturnsBlockedMissingProvider_WithoutLeakingSecret()
    {
        var provider = new HttpLlmProvider(new HttpClient(new StubHttpMessageHandler((_, _) => throw new InvalidOperationException("should not send"))),
            new LlmProviderConfiguration("stub-http", null, "super-secret-key", "stub-model", false));

        var health = provider.GetHealth();
        Assert.Equal("blocked_missing_provider", health.StatusCode);
        Assert.DoesNotContain("super-secret-key", JsonSerializer.Serialize(health), StringComparison.Ordinal);

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-http-missing",
                new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Hello") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-http-missing", request, provider);
            var failed = Assert.IsType<LlmRequestFailedReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));
            Assert.Equal("blocked_missing_provider", failed.Error.Code);
            Assert.DoesNotContain("super-secret-key", failed.Error.Message, StringComparison.Ordinal);

            var state = await actor.Ask<LlmRequestState>(new LlmInspect(), TimeSpan.FromSeconds(10));
            Assert.NotNull(state.Error);
            Assert.DoesNotContain("super-secret-key", state.Error!.Message, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void HttpLlmProvider_UploadProviderFile_OnNonOpenAiProtocol_IsRejected()
    {
        var provider = CreateHttpProvider((_, _) => throw new InvalidOperationException("should not send"));
        var artifact = CreateUploadArtifact("data:application/pdf;base64,JVBERi0x");

        var error = Assert.Throws<LlmProviderException>(() => provider.UploadProviderFile(artifact, "test", "provider_file"));

        Assert.Equal("provider_file_upload_not_supported", error.Error.Code);
    }

    [Fact]
    public void HttpLlmProvider_UploadProviderFile_MissingProviderConfiguration_ReturnsBlockedMissingProvider()
    {
        var provider = new HttpLlmProvider(
            new HttpClient(new StubHttpMessageHandler((_, _) => throw new InvalidOperationException("should not send"))),
            new LlmProviderConfiguration("openai", null, null, "gpt-4.1", true, "openai.responses"));
        var artifact = CreateUploadArtifact("data:application/pdf;base64,JVBERi0x");

        var error = Assert.Throws<LlmProviderException>(() => provider.UploadProviderFile(artifact, "test", "openai.responses.file_id"));

        Assert.Equal("blocked_missing_provider", error.Error.Code);
    }

    [Fact]
    public void HttpLlmProvider_UploadProviderFile_HttpFailure_PreservesRetryability()
    {
        var tooManyRequestsProvider = CreateHttpProvider((_, _) => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
        {
            Content = new StringContent("slow down", Encoding.UTF8, "text/plain")
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");
        var artifact = CreateUploadArtifact("data:application/pdf;base64,JVBERi0x");

        var error = Assert.Throws<LlmProviderException>(() => tooManyRequestsProvider.UploadProviderFile(artifact, "test", "openai.responses.file_id"));

        Assert.Equal("provider_rate_limited", error.Error.Code);
        Assert.True(error.Error.Retryable);
    }

    [Fact]
    public void HttpLlmProvider_UploadProviderFile_MalformedJsonResponse_IsStable()
    {
        var provider = CreateHttpProvider((_, _) => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{not-json", Encoding.UTF8, "application/json")
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");
        var artifact = CreateUploadArtifact("data:application/pdf;base64,JVBERi0x");

        var error = Assert.Throws<LlmProviderException>(() => provider.UploadProviderFile(artifact, "test", "openai.responses.file_id"));

        Assert.Equal("provider_file_upload_invalid_response", error.Error.Code);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"id\":\"\"}")]
    [InlineData("{\"id\":\"   \"}")]
    public void HttpLlmProvider_UploadProviderFile_MissingOrBlankId_IsStable(string body)
    {
        var provider = CreateHttpProvider((_, _) => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");
        var artifact = CreateUploadArtifact("data:application/pdf;base64,JVBERi0x");

        var error = Assert.Throws<LlmProviderException>(() => provider.UploadProviderFile(artifact, "test", "openai.responses.file_id"));

        Assert.Equal("provider_file_upload_invalid_response", error.Error.Code);
    }

    [Fact]
    public async Task HttpProvider_MalformedExecuteJson_MapsToStableProviderFailure()
    {
        var provider = CreateHttpProvider((_, _) => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{not-json", Encoding.UTF8, "application/json")
        });

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-http-malformed-json",
                new LlmModelCapabilities("stub-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Hello") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-http-malformed-json", request, provider);
            var failed = Assert.IsType<LlmRequestFailedReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.Equal("provider_invalid_response", failed.Error.Code);
            Assert.DoesNotContain("JsonException", failed.Error.Message, StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task HttpProvider_OpenAiResponses_Refusal_IsPreserved()
    {
        var provider = CreateHttpProvider(
            (_, _) => JsonResponse(new
            {
                id = "resp_refusal",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new
                    {
                        content = new object[]
                        {
                            new { type = "refusal", refusal = "I refuse this request." }
                        }
                    }
                },
                usage = new { input_tokens = 2, output_tokens = 0, total_tokens = 2 }
            }),
            protocol: "openai.responses",
            providerName: "openai",
            model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var request = CreateRequest(
                "req-openai-refusal-preserved",
                new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("Unsafe") },
                new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "unused"));

            var actor = CreateWorker(system, "llm-openai-refusal-preserved", request, provider);
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(10)));

            Assert.Equal("I refuse this request.", reply.Response.Refusal);
        });
    }

    [Fact]
    public async Task LlmGateway_RejectsMissingCapability_WhenAuthorityConfigured()
    {
        Directory.CreateDirectory(_blobRoot);

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-capability-required-recorder");
            var replyTo = new ActorAddress("tests/replies/llm-capability-required", "local");
            resolver.Register(replyTo, recorder);

            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-llm-capability-required-schema")), "phase10-llm-capability-required-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var blobStore = new ToolkitFileSystemArtifactBlobStore(_blobRoot);
            var artifactStore = new SqliteArtifactStore($"Data Source={_databasePath}");
            var blob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"invoiceNumber\":\"INV-CAP-REQ\"}"));
            var artifact = await artifactStore.CreateArtifactAsync("invoice-capability-required.json", "application/json", "upload", blob, null, CancellationToken.None);

            var provider = CreateHttpProvider((_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-model",
                structuredJson = new { invoiceNumber = "INV-CAP-REQ" },
                finishReason = "structured_stop",
                usage = new { promptTokens = 8, completionTokens = 4, totalTokens = 12, cost = 0.01m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }));

            var authority = CreateLlmAuthority();
            var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var gateway = system.ActorOf(
                Props.Create(() => new LlmGatewayActor(resolver, schemaActor, pipeline, CreateInboxStore("llm-capability-required"), authority)),
                "phase10-llm-capability-required");

            var senderAddress = new ActorAddress("agent/agent-capability-required", "local");
            var payload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-capability-required",
                Artifact: new ToolkitArtifactRef(artifact.ArtifactId, artifact.RevisionId),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields",
                Purpose: "accounting.invoice.extract",
                CapabilityId: null));

            var rejected = Assert.IsType<DeliveryRejected>(
                await gateway.Ask<object>(CreateDeliveryAttemptOffer(senderAddress, replyTo, payload), TimeSpan.FromSeconds(10)));

            Assert.Equal("capability_required", rejected.Error.Code);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task LlmOperationAdapter_UsesEnvelopeCapabilityId_WhenPayloadCapabilityIdIsMissing()
    {
        Directory.CreateDirectory(_blobRoot);

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-envelope-capability-recorder");
            var replyTo = new ActorAddress("tests/replies/llm-envelope-capability", "local");
            resolver.Register(replyTo, recorder);

            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-llm-envelope-capability-schema")), "phase10-llm-envelope-capability-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var blobStore = new ToolkitFileSystemArtifactBlobStore(_blobRoot);
            var artifactStore = new SqliteArtifactStore($"Data Source={_databasePath}");
            var blob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"invoiceNumber\":\"INV-ENV-CAP\"}"));
            var artifact = await artifactStore.CreateArtifactAsync("invoice-envelope-cap.json", "application/json", "upload", blob, null, CancellationToken.None);

            var provider = CreateHttpProvider((_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-model",
                structuredJson = new { invoiceNumber = "INV-ENV-CAP" },
                finishReason = "structured_stop",
                usage = new { promptTokens = 8, completionTokens = 4, totalTokens = 12, cost = 0.01m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }));
            var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var adapter = system.ActorOf(Props.Create(() => new LlmGatewayActor(resolver, schemaActor, pipeline, CreateInboxStore("llm-envelope-capability"))), "phase10-llm-envelope-capability");

            var senderAddress = new ActorAddress("agent/agent-envelope-cap", "local");
            var payload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-envelope-cap",
                Artifact: new ToolkitArtifactRef(artifact.ArtifactId, artifact.RevisionId),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields",
                Purpose: "accounting.invoice.extract",
                CapabilityId: null));

            var offer = CreateDeliveryAttemptOffer(senderAddress, replyTo, payload) with
            {
                Envelope = CreateDeliveryAttemptOffer(senderAddress, replyTo, payload).Envelope with { CapabilityId = new CapabilityId("llm-generate-cap") }
            };

            var result = await adapter.Ask<object>(offer, TimeSpan.FromSeconds(10));

            var accepted = Assert.IsType<DeliveryAccepted>(result);
            Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
            var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
            Assert.Equal("llm-envelope-cap", resolved.Key.RequestId.Value);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task LlmOperationAdapter_OperationResolved_UsesEnvelopeSenderAsOperationKeyCaller()
    {
        Directory.CreateDirectory(_blobRoot);

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-adapter-recorder");
            var replyTo = new ActorAddress("tests/replies/llm-adapter", "local");
            resolver.Register(replyTo, recorder);

            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-llm-adapter-schema")), "phase10-llm-adapter-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var blobStore = new ToolkitFileSystemArtifactBlobStore(_blobRoot);
            var artifactStore = new SqliteArtifactStore($"Data Source={_databasePath}");
            var blob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"invoiceNumber\":\"INV-ADAPTER-1\"}"));
            var artifact = await artifactStore.CreateArtifactAsync("invoice.json", "application/json", "upload", blob, null, CancellationToken.None);

            var provider = CreateHttpProvider((_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-model",
                structuredJson = new { invoiceNumber = "INV-ADAPTER-1" },
                finishReason = "structured_stop",
                usage = new { promptTokens = 8, completionTokens = 4, totalTokens = 12, cost = 0.01m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }));
            var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var adapter = system.ActorOf(Props.Create(() => new LlmGatewayActor(resolver, schemaActor, pipeline, CreateInboxStore("llm-adapter"))), "phase10-llm-adapter");

            var senderAddress = new ActorAddress("agent/agent-1", "local");
            var payload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-1",
                Artifact: new ToolkitArtifactRef(artifact.ArtifactId, artifact.RevisionId),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields",
                Purpose: "accounting.invoice.extract"));

            var offer = CreateDeliveryAttemptOffer(senderAddress, replyTo, payload);
            var result = await adapter.Ask<object>(offer, TimeSpan.FromSeconds(10));

            var accepted = Assert.IsType<DeliveryAccepted>(result);
            Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
            var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
            Assert.Equal(senderAddress, resolved.Key.Caller);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task LlmOperationAdapter_AcceptsDeliveryBeforeExtractionCompletes()
    {
        Directory.CreateDirectory(_blobRoot);

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-accepts-before-complete-recorder");
            var replyTo = new ActorAddress("tests/replies/llm-adapter-slow", "local");
            resolver.Register(replyTo, recorder);

            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-llm-accepts-before-complete-schema")), "phase10-llm-accepts-before-complete-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var blobStore = new ToolkitFileSystemArtifactBlobStore(_blobRoot);
            var artifactStore = new SqliteArtifactStore($"Data Source={_databasePath}");
            var blob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"invoiceNumber\":\"INV-SLOW-1\"}"));
            var artifact = await artifactStore.CreateArtifactAsync("invoice-slow.json", "application/json", "upload", blob, null, CancellationToken.None);

            var provider = CreateHttpProvider((_, _) =>
            {
                Thread.Sleep(750);
                return JsonResponse(new
                {
                    provider = "stub-http",
                    model = "stub-model",
                    structuredJson = new { invoiceNumber = "INV-SLOW-1" },
                    finishReason = "structured_stop",
                    usage = new { promptTokens = 8, completionTokens = 4, totalTokens = 12, cost = 0.01m },
                    citations = Array.Empty<string>(),
                    degradations = Array.Empty<object>(),
                    toolCalls = Array.Empty<object>()
                });
            });

            var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var adapter = system.ActorOf(Props.Create(() => new LlmGatewayActor(resolver, schemaActor, pipeline, CreateInboxStore("llm-accepts-before-complete"))), "phase10-llm-accepts-before-complete");

            var payload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-slow-1",
                Artifact: new ToolkitArtifactRef(artifact.ArtifactId, artifact.RevisionId),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields",
                Purpose: "accounting.invoice.extract"));

            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer(new ActorAddress("agent/agent-slow", "local"), replyTo, payload), TimeSpan.FromSeconds(10));
            stopwatch.Stop();

            var accepted = Assert.IsType<DeliveryAccepted>(result);
            Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
            Assert.True(stopwatch.ElapsedMilliseconds < 700, $"Expected early acceptance before provider completed, but acceptance took {stopwatch.ElapsedMilliseconds}ms.");

            var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
            Assert.Equal("llm-slow-1", resolved.Key.RequestId.Value);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task LlmOperationAdapter_SchemaValidationFailure_AfterAccepted_SendsOperationFailed()
    {
        Directory.CreateDirectory(_blobRoot);

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-invalid-recorder");
            var replyTo = new ActorAddress("tests/replies/llm-adapter-invalid", "local");
            resolver.Register(replyTo, recorder);

            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-llm-invalid-schema")), "phase10-llm-invalid-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var blobStore = new ToolkitFileSystemArtifactBlobStore(_blobRoot);
            var artifactStore = new SqliteArtifactStore($"Data Source={_databasePath}");
            var blob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{}"));
            var artifact = await artifactStore.CreateArtifactAsync("invoice-invalid.json", "application/json", "upload", blob, null, CancellationToken.None);

            var provider = CreateHttpProvider((_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-model",
                structuredJson = new { vendor = "Missing invoice number" },
                finishReason = "structured_stop",
                usage = new { promptTokens = 8, completionTokens = 4, totalTokens = 12, cost = 0.01m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }));

            var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var adapter = system.ActorOf(Props.Create(() => new LlmGatewayActor(resolver, schemaActor, pipeline, CreateInboxStore("llm-invalid"))), "phase10-llm-invalid");

            var payload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-invalid-1",
                Artifact: new ToolkitArtifactRef(artifact.ArtifactId, artifact.RevisionId),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields",
                Purpose: "accounting.invoice.extract"));

            var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer(new ActorAddress("agent/agent-invalid", "local"), replyTo, payload), TimeSpan.FromSeconds(10));

            var accepted = Assert.IsType<DeliveryAccepted>(result);
            Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);

            var failed = await WaitForMessageAsync<Aven.Contracts.Operations.OperationFailed>(recorder, TimeSpan.FromSeconds(5));
            Assert.Equal("llm_extraction_invalid", failed.Error.Code);
            Assert.False(failed.Error.Retryable);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task LlmOperationAdapter_DoesNotBlockMailboxWhileExtractionRuns()
    {
        Directory.CreateDirectory(_blobRoot);

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var firstRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-mailbox-first-recorder");
            var secondRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-mailbox-second-recorder");
            var firstReplyTo = new ActorAddress("tests/replies/llm-mailbox-first", "local");
            var secondReplyTo = new ActorAddress("tests/replies/llm-mailbox-second", "local");
            resolver.Register(firstReplyTo, firstRecorder);
            resolver.Register(secondReplyTo, secondRecorder);

            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-llm-mailbox-schema")), "phase10-llm-mailbox-schema");
            var contract = InvoiceContract(strict: true);
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var blobStore = new ToolkitFileSystemArtifactBlobStore(_blobRoot);
            var artifactStore = new SqliteArtifactStore($"Data Source={_databasePath}");
            var blob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"invoiceNumber\":\"INV-MAILBOX-1\"}"));
            var artifact = await artifactStore.CreateArtifactAsync("invoice-mailbox.json", "application/json", "upload", blob, null, CancellationToken.None);

            var provider = new ScriptedLlmProvider(
                new ScriptedLlmBehavior("llm-mailbox-slow", TimeSpan.FromMilliseconds(900), "{\"invoiceNumber\":\"INV-MAILBOX-SLOW\"}"),
                new ScriptedLlmBehavior("llm-mailbox-fast", TimeSpan.Zero, "{\"invoiceNumber\":\"INV-MAILBOX-FAST\"}"));

            var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var adapter = system.ActorOf(Props.Create(() => new LlmGatewayActor(resolver, schemaActor, pipeline, CreateInboxStore("llm-mailbox"))), "phase10-llm-mailbox");

            var firstPayload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-mailbox-slow",
                Artifact: new ToolkitArtifactRef(artifact.ArtifactId, artifact.RevisionId),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields slowly",
                Purpose: "accounting.invoice.extract"));
            var secondPayload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-mailbox-fast",
                Artifact: new ToolkitArtifactRef(artifact.ArtifactId, artifact.RevisionId),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields quickly",
                Purpose: "accounting.invoice.extract"));

            var firstAccepted = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(
                CreateDeliveryAttemptOffer(new ActorAddress("agent/agent-mailbox-first", "local"), firstReplyTo, firstPayload),
                TimeSpan.FromSeconds(10)));
            Assert.Equal("resource_operation_recorded", firstAccepted.AcceptanceKind);

            var secondAckStopwatch = System.Diagnostics.Stopwatch.StartNew();
            var secondAccepted = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(
                CreateDeliveryAttemptOffer(new ActorAddress("agent/agent-mailbox-second", "local"), secondReplyTo, secondPayload),
                TimeSpan.FromSeconds(10)));
            secondAckStopwatch.Stop();

            Assert.Equal("resource_operation_recorded", secondAccepted.AcceptanceKind);
            Assert.True(
                secondAckStopwatch.ElapsedMilliseconds < 250,
                $"Expected second delivery acceptance while first extraction was still running, but acceptance took {secondAckStopwatch.ElapsedMilliseconds}ms.");

            var firstResolved = await WaitForMessageAsync<OperationResolved>(firstRecorder, TimeSpan.FromSeconds(5));
            var secondResolved = await WaitForMessageAsync<OperationResolved>(secondRecorder, TimeSpan.FromSeconds(5));
            Assert.Equal("llm-mailbox-slow", firstResolved.Key.RequestId.Value);
            Assert.Equal("llm-mailbox-fast", secondResolved.Key.RequestId.Value);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task LlmOperationAdapter_ExtractionException_AfterAccepted_SendsOperationFailed()
    {
        Directory.CreateDirectory(_blobRoot);

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase10-llm-exception-recorder");
            var replyTo = new ActorAddress("tests/replies/llm-adapter-exception", "local");
            resolver.Register(replyTo, recorder);

            var contract = InvoiceContract(strict: true);
            var schemaActor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("phase10-llm-exception-schema")), "phase10-llm-exception-schema");
            await schemaActor.Ask<SchemaRegistered>(new SchemaRegister(contract.SchemaRef, contract.JsonSchema, "invoice schema"), TimeSpan.FromSeconds(3));

            var blobStore = new ToolkitFileSystemArtifactBlobStore(_blobRoot);
            var artifactStore = new SqliteArtifactStore($"Data Source={_databasePath}");
            var provider = new ScriptedLlmProvider();

            var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(new InMemoryProviderFileRegistry()));
            var adapter = system.ActorOf(Props.Create(() => new LlmGatewayActor(resolver, schemaActor, pipeline, CreateInboxStore("llm-exception"))), "phase10-llm-exception");

            var payload = JsonSerializer.Serialize(new LlmGenerateOperationPayload(
                RequestId: "llm-error-1",
                Artifact: new ToolkitArtifactRef(new ToolkitArtifactId("artifact-missing"), new ToolkitArtifactRevisionId("revision-missing")),
                SchemaRef: contract.SchemaRef,
                Prompt: "Extract invoice fields",
                Purpose: "accounting.invoice.extract"));

            var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer(new ActorAddress("agent/agent-error", "local"), replyTo, payload), TimeSpan.FromSeconds(10));

            var accepted = Assert.IsType<DeliveryAccepted>(result);
            Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);

            var failed = await WaitForMessageAsync<Aven.Contracts.Operations.OperationFailed>(recorder, TimeSpan.FromSeconds(5));
            Assert.Equal("llm_extraction_failed", failed.Error.Code);
            Assert.False(failed.Error.Retryable);
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        if (Directory.Exists(_blobRoot))
        {
            Directory.Delete(_blobRoot, recursive: true);
        }

        return Task.CompletedTask;
    }

    private static DeliveryAttemptOffer CreateDeliveryAttemptOffer(ActorAddress sender, ActorAddress replyTo, string payload) =>
        new(
            new DeliveryId($"delivery-{Guid.NewGuid():N}"),
            new AvenEnvelope<string>(
                new CommandId($"command-{Guid.NewGuid():N}"),
                new MessageId($"message-{Guid.NewGuid():N}"),
                sender,
                new ActorAddress("resource/llm", "local"),
                replyTo,
                new CorrelationId($"corr-{Guid.NewGuid():N}"),
                "llm.generate",
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            $"payload-{Guid.NewGuid():N}");

    private static async Task<TMessage> WaitForMessageAsync<TMessage>(IActorRef recorder, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var messages = await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
            var match = messages.OfType<TMessage>().FirstOrDefault();
            if (match is not null)
            {
                return match;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"Timed out waiting for {typeof(TMessage).Name}.");
    }

    private async Task WithSystem(Func<ActorSystem, Task> action)
    {
        var config = ConfigurationFactory.ParseString($$"""
            akka {
              loglevel = WARNING
              stdout-loglevel = WARNING
              persistence {
                journal.plugin = "akka.persistence.journal.sqlite"
                snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
                journal.sqlite {
                  class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase10-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static IActorRef CreateWorker(ActorSystem system, string persistenceId, LlmRequest request, ILlmProvider? provider = null)
    {
        return system.ActorOf(
            Props.Create(() => new LlmRequestWorkerActor(persistenceId, request, provider ?? new InMemoryLlmProvider())),
            persistenceId.Replace('/', '-'));
    }

    private static LlmRequest CreateRequest(
        string requestId,
        LlmModelCapabilities model,
        IReadOnlyList<LlmInputBlock> input,
        InMemoryLlmResponsePlan plan,
        StructuredOutputContract? structuredOutput = null)
    {
        var key = new OperationKey(new ActorAddress("caller/a", "local"), new RequestId(requestId), "llm.generate");
        InMemoryLlmProvider.Configure(requestId, plan);
        return new LlmRequest(
            key,
            new CorrelationId($"corr-{requestId}"),
            new ActorAddress("resource/llm", "local"),
            new ActorAddress("reply/a", "local"),
            model,
            input,
            structuredOutput,
            Array.Empty<ProviderFileDescriptor>(),
            new LlmReasoningOptions(true, "small"),
            new LlmBudgetLimits(1.0m, 1000, 500),
            new LlmSafetySettings(),
            null);
    }

    private static StructuredOutputContract InvoiceContract(bool strict) => new(
        new SchemaRef("schema://accounting/invoice-extraction@1"),
        "{\"type\":\"object\",\"required\":[\"invoiceNumber\"],\"properties\":{\"invoiceNumber\":{\"type\":\"string\"}}}",
        strict);

    private static HttpLlmProvider CreateHttpProvider(
        Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> responder,
        string providerName = "stub-http",
        string model = "stub-model",
        string? protocol = null)
    {
        var client = new HttpClient(new StubHttpMessageHandler(responder))
        {
            BaseAddress = new Uri("http://localhost")
        };

        return new HttpLlmProvider(
            client,
            new LlmProviderConfiguration(providerName, "http://localhost", "secret-token", model, true, protocol));
    }

    private static HttpResponseMessage JsonResponse(object payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
    };

    private static ArtifactSourceDescriptor CreateUploadArtifact(string inlineDataUrl) =>
        new(
            new ToolkitArtifactRef(new ToolkitArtifactId("artifact-upload"), new ToolkitArtifactRevisionId("revision-upload")),
            "artifact-upload.pdf",
            "application/pdf",
            new ToolkitBlobRef("sha256", "hash-upload", 4),
            null,
            inlineDataUrl);

    private static ICapabilityAdmissionClient CreateLlmAuthority()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(new CapabilityGrant(
            new CapabilityId("llm-generate-cap"),
            new ActorAddress("caller/a", "local"),
            new ActorAddress("resource/llm", "local"),
            new HashSet<string>(StringComparer.Ordinal) { "llm.generate" },
            new CapabilityConstraints(MaxUses: 10),
            false,
            null,
            DateTimeOffset.UtcNow.AddMinutes(5),
            null));
        return authority;
    }

    private static ICapabilityAdmissionClient CreateStructuredGenerationAuthority()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(new CapabilityGrant(
            new CapabilityId("api-routing-llm-cap"),
            new ActorAddress("api/routing", "local"),
            ResourceAddresses.Gateway(ResourceKinds.Llm),
            new HashSet<string>(StringComparer.Ordinal) { ResourceOperationTypes.LlmStructuredGenerate },
            new CapabilityConstraints(MaxUses: 10),
            false,
            null,
            DateTimeOffset.UtcNow.AddMinutes(5),
            null));
        return authority;
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private static ResourceOperationInboxStore CreateInboxStore(string name) =>
        new($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-phase10-inbox-{name}-{Guid.NewGuid():N}.sqlite")}");

    private sealed record GetRecordedMessages;

    private sealed class RecordingActor : ReceiveActor
    {
        private readonly List<object> _messages = new();

        public RecordingActor()
        {
            Receive<GetRecordedMessages>(_ => Sender.Tell(_messages.ToArray()));
            ReceiveAny(message => _messages.Add(message));
        }
    }

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> _responder;

        public StubHttpMessageHandler(Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> responder)
        {
            _responder = responder;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(_responder(request, cancellationToken));
    }

    private sealed class CountingLlmProvider(string structuredJson) : ILlmProvider
    {
        private int _callCount;

        public string Name => "counting";

        public int CallCount => Volatile.Read(ref _callCount);

        public LlmProviderHealth GetHealth() => new(Name, true, true, "ok", "Counting test provider is configured.", "stub-model");

        public Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _callCount);
            return Task.FromResult(new LlmResponse(
                Name,
                request.Model.ModelName,
                null,
                structuredJson,
                Array.Empty<LlmToolCall>(),
                null,
                null,
                null,
                Array.Empty<string>(),
                new LlmUsage(8, 4, 12, 0.01m),
                "structured_stop",
                Array.Empty<LlmProviderDegradation>(),
                request.StructuredOutput?.SchemaRef,
                true));
        }
    }

    private sealed class AlwaysFailingLlmProvider : ILlmProvider
    {
        public string Name => "always-failing";

        public LlmProviderHealth GetHealth() => new(Name, true, true, "ok", "Failing test provider is configured.", "fake-parent-failed");

        public Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default) =>
            throw new LlmProviderException(new OperationError("provider_terminal_failure", "Provider failed after external call start.", false));
    }

    private sealed record ScriptedLlmBehavior(
        string RequestId,
        TimeSpan Delay,
        string? StructuredJson = null);

    private sealed class ScriptedLlmProvider : ILlmProvider
    {
        private readonly Dictionary<string, ScriptedLlmBehavior> _behaviors;

        public ScriptedLlmProvider(params ScriptedLlmBehavior[] behaviors)
        {
            _behaviors = behaviors.ToDictionary(x => x.RequestId, StringComparer.Ordinal);
        }

        public string Name => "scripted";

        public LlmProviderHealth GetHealth() => new(Name, true, true, "ok", "Scripted test provider is configured.", "scripted-model");

        public async Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default)
        {
            if (!_behaviors.TryGetValue(request.Key.RequestId.Value, out var behavior))
            {
                throw new InvalidOperationException($"No scripted LLM behavior configured for request '{request.Key.RequestId.Value}'.");
            }

            if (behavior.Delay > TimeSpan.Zero)
            {
                await Task.Delay(behavior.Delay, cancellationToken);
            }

            return new LlmResponse(
                Name,
                request.Model.ModelName,
                null,
                behavior.StructuredJson ?? "{}",
                Array.Empty<LlmToolCall>(),
                null,
                null,
                null,
                Array.Empty<string>(),
                new LlmUsage(8, 4, 12, 0.01m),
                "structured_stop",
                Array.Empty<LlmProviderDegradation>(),
                request.StructuredOutput?.SchemaRef,
                true);
        }
    }

    private sealed record CapturedHttpRequest(
        HttpMethod Method,
        string RequestUri,
        string? AuthorizationScheme,
        string? AuthorizationParameter,
        string Body)
    {
        public static CapturedHttpRequest From(HttpRequestMessage request)
        {
            var body = request.Content is null
                ? string.Empty
                : request.Content.ReadAsStringAsync().GetAwaiter().GetResult();

            return new CapturedHttpRequest(
                request.Method,
                request.RequestUri?.ToString() ?? string.Empty,
                request.Headers.Authorization?.Scheme,
                request.Headers.Authorization?.Parameter,
                body);
        }
    }
}