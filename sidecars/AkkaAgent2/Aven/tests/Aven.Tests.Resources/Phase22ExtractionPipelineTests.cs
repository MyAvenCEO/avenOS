using System.Net;
using System.Text;
using System.Text.Json;
using Akka.Actor;
using Akka.Configuration;
using Aven.Resources.Artifacts;
using Aven.Resources.Llm;
using ToolkitFileSystemArtifactBlobStore = Aven.Toolkit.Artifacts.FileSystemArtifactBlobStore;

namespace Aven.Tests.Resources;

public sealed class Phase22ExtractionPipelineTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase22-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public async Task InvoicePdfArtifact_ExtractsSchemaValidJson_ThroughStubProvider_WithEvidence()
    {
        var provider = CreateHttpProvider((_, _) => JsonResponse(new
        {
            provider = "stub-http",
            model = "stub-model",
            structuredJson = new { invoiceNumber = "INV-22", vendor = "Vendor GmbH" },
            finishReason = "structured_stop",
            usage = new { promptTokens = 20, completionTokens = 10, totalTokens = 30, cost = 0.12m },
            citations = new[] { "page-1" },
            degradations = Array.Empty<object>(),
            toolCalls = Array.Empty<object>()
        }));

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-invoice-schema");
            await RegisterSchema(schemaActor, InvoiceSchemaRef, InvoiceSchemaJson);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var result = await pipeline.ExtractAsync(
                "phase22/invoice-worker",
                schemaActor,
                await CreateRequestAsync(
                    pipelineContext.ArtifactStore,
                    pipelineContext.BlobStore,
                    requestId: "invoice",
                    schemaRef: InvoiceSchemaRef,
                    schemaJson: InvoiceSchemaJson,
                    mimeType: "application/pdf",
                    structuredJson: "{\"invoiceNumber\":\"unused\",\"vendor\":\"unused\"}"));

            Assert.True(result.SchemaValidated);
            Assert.Empty(result.ValidationErrors);
            Assert.Equal(InvoiceSchemaRef, result.SchemaRef);
            Assert.Contains("INV-22", result.StructuredJson, StringComparison.Ordinal);
            var evidence = Assert.Single(result.Evidence);
            Assert.Equal("provider-file:full-document", evidence.Locator);
            Assert.False(evidence.IsDegraded);
            Assert.Equal("provider_file", result.TransportSummary);
        });
    }

    [Fact]
    public async Task StatementImageArtifact_ExtractsSchemaValidJson_ThroughStubProvider()
    {
        var provider = CreateHttpProvider((_, _) => JsonResponse(new
        {
            provider = "stub-http",
            model = "vision-model",
            structuredJson = new { statementId = "STMT-22", transactionReference = "TX-22" },
            finishReason = "structured_stop",
            usage = new { promptTokens = 15, completionTokens = 8, totalTokens = 23, cost = 0.09m },
            citations = Array.Empty<string>(),
            degradations = Array.Empty<object>(),
            toolCalls = Array.Empty<object>()
        }));

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-statement-schema");
            await RegisterSchema(schemaActor, StatementSchemaRef, StatementSchemaJson);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var result = await pipeline.ExtractAsync(
                "phase22/statement-worker",
                schemaActor,
                await CreateRequestAsync(
                    pipelineContext.ArtifactStore,
                    pipelineContext.BlobStore,
                    requestId: "statement",
                    schemaRef: StatementSchemaRef,
                    schemaJson: StatementSchemaJson,
                    mimeType: "image/png",
                    structuredJson: "{\"statementId\":\"unused\",\"transactionReference\":\"unused\"}"));

            Assert.True(result.SchemaValidated);
            Assert.Equal("image_artifact", result.TransportSummary);
            Assert.Equal("image:full-artifact", Assert.Single(result.Evidence).Locator);
        });
    }

    [Fact]
    public async Task InvalidJson_ProducesValidationFailure_AndDoesNotBecomeTrustedData()
    {
        var provider = CreateHttpProvider((_, _) => JsonResponse(new
        {
            provider = "stub-http",
            model = "stub-model",
            structuredJson = new { vendor = "Missing invoice number" },
            finishReason = "structured_stop",
            usage = new { promptTokens = 10, completionTokens = 5, totalTokens = 15, cost = 0.05m },
            citations = Array.Empty<string>(),
            degradations = Array.Empty<object>(),
            toolCalls = Array.Empty<object>()
        }));

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-invalid-schema");
            await RegisterSchema(schemaActor, InvoiceSchemaRef, InvoiceSchemaJson);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var result = await pipeline.ExtractAsync(
                "phase22/invalid-worker",
                schemaActor,
                await CreateRequestAsync(
                    pipelineContext.ArtifactStore,
                    pipelineContext.BlobStore,
                    requestId: "invalid",
                    schemaRef: InvoiceSchemaRef,
                    schemaJson: InvoiceSchemaJson,
                    mimeType: "application/pdf",
                    structuredJson: "{\"invoiceNumber\":\"unused\"}"));

            Assert.False(result.SchemaValidated);
            Assert.NotNull(result.StructuredJson);
            Assert.NotEmpty(result.ValidationErrors);
            Assert.Contains(result.ValidationErrors, error => error.Contains("invoiceNumber", StringComparison.OrdinalIgnoreCase));
            Assert.Equal("provider_file", result.TransportSummary);
        });
    }

    [Fact]
    public async Task WrongSchemaVersion_DoesNotValidateSilentlyAgainstAnotherRegisteredVersion()
    {
        var provider = CreateHttpProvider((_, _) => JsonResponse(new
        {
            provider = "stub-http",
            model = "stub-model",
            structuredJson = new { invoiceNumber = "INV-22" },
            finishReason = "structured_stop",
            usage = new { promptTokens = 10, completionTokens = 5, totalTokens = 15, cost = 0.05m },
            citations = Array.Empty<string>(),
            degradations = Array.Empty<object>(),
            toolCalls = Array.Empty<object>()
        }));

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-version-schema");
            await RegisterSchema(schemaActor, new SchemaRef("schema://accounting/invoice@1"), InvoiceSchemaJson);
            await RegisterSchema(schemaActor, InvoiceSchemaRef, InvoiceSchemaV2Json);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var result = await pipeline.ExtractAsync(
                "phase22/version-worker",
                schemaActor,
                await CreateRequestAsync(
                    pipelineContext.ArtifactStore,
                    pipelineContext.BlobStore,
                    requestId: "version",
                    schemaRef: InvoiceSchemaRef,
                    schemaJson: InvoiceSchemaV2Json,
                    mimeType: "application/pdf",
                    structuredJson: "{\"invoiceNumber\":\"unused\"}"));

            Assert.False(result.SchemaValidated);
            Assert.Contains(result.ValidationErrors, error => error.Contains("currency", StringComparison.OrdinalIgnoreCase));
        });
    }

    [Fact]
    public async Task TextFallback_RecordsDegradationAndDegradedEvidenceAnchor()
    {
        var provider = CreateHttpProvider((_, _) => JsonResponse(new
        {
            provider = "stub-http",
            model = "text-only-model",
            structuredJson = new { invoiceNumber = "INV-TEXT" },
            finishReason = "structured_stop",
            usage = new { promptTokens = 12, completionTokens = 6, totalTokens = 18, cost = 0.07m },
            citations = Array.Empty<string>(),
            degradations = Array.Empty<object>(),
            toolCalls = Array.Empty<object>()
        }));

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-fallback-schema");
            await RegisterSchema(schemaActor, InvoiceSchemaRef, InvoiceSchemaJson);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var request = await CreateRequestAsync(
                pipelineContext.ArtifactStore,
                pipelineContext.BlobStore,
                requestId: "fallback",
                schemaRef: InvoiceSchemaRef,
                schemaJson: InvoiceSchemaJson,
                mimeType: "application/pdf",
                structuredJson: "{\"invoiceNumber\":\"unused\"}",
                allowTextFallback: true,
                model: new LlmModelCapabilities("text-only-model", false, false, false, true, true, false),
                inlineText: "Invoice INV-TEXT");

            var result = await pipeline.ExtractAsync("phase22/fallback-worker", schemaActor, request);

            Assert.True(result.SchemaValidated);
            Assert.Contains(result.Degradations, degradation => degradation.Code == "text_fallback_pdf");
            Assert.True(Assert.Single(result.Evidence).IsDegraded);
            Assert.Equal("inline-text:derived-content", Assert.Single(result.Evidence).Locator);
        });
    }

    [Fact]
    public async Task OpenAiResponses_PdfExtraction_UsesInputFileDataUrl_AndReturnsValidatedEvidence()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_pdf_extract",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = "{\"invoiceNumber\":\"INV-OAI-PDF\"}" } } }
                },
                usage = new { input_tokens = 10, output_tokens = 4, total_tokens = 14 }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-openai-pdf-schema");
            await RegisterSchema(schemaActor, InvoiceSchemaRef, InvoiceSchemaJson);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var result = await pipeline.ExtractAsync(
                "phase22/openai-pdf-worker",
                schemaActor,
                await CreateRequestAsync(
                    pipelineContext.ArtifactStore,
                    pipelineContext.BlobStore,
                    requestId: "openai-pdf",
                    schemaRef: InvoiceSchemaRef,
                    schemaJson: InvoiceSchemaJson,
                    mimeType: "application/pdf",
                    structuredJson: "unused",
                    providerName: "openai",
                    inlineDataUrl: "data:application/pdf;base64,JVBERi0x"));

            Assert.True(result.SchemaValidated);
            Assert.Equal("openai_responses_input_file_data_url", result.TransportSummary);
            Assert.Equal("openai.responses:input_file:data_url", Assert.Single(result.Evidence).Locator);

            using var json = JsonDocument.Parse(capturedRequest!.Body);
            Assert.Equal("input_file", json.RootElement.GetProperty("input")[1].GetProperty("content")[0].GetProperty("type").GetString());
            Assert.Equal("data:application/pdf;base64,JVBERi0x", json.RootElement.GetProperty("input")[1].GetProperty("content")[0].GetProperty("file_data").GetString());
        });
    }

    [Fact]
    public async Task OpenAiResponses_PdfExtraction_UsesUploadedFileId_AndReusesItWithoutSecondUpload()
    {
        CapturedHttpRequest? responsesRequest = null;
        var uploadCount = 0;
        var provider = CreateHttpProvider((request, _) =>
        {
            if (request.RequestUri?.AbsolutePath.EndsWith("/files", StringComparison.Ordinal) == true)
            {
                uploadCount++;
                return JsonResponse(new { id = "file-openai-1" });
            }

            responsesRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_pdf_uploaded",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = "{\"invoiceNumber\":\"INV-UPLOADED\"}" } } }
                },
                usage = new { input_tokens = 8, output_tokens = 4, total_tokens = 12 }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-openai-upload-schema");
            await RegisterSchema(schemaActor, InvoiceSchemaRef, InvoiceSchemaJson);

            var registry = new ActorBackedProviderFileRegistry(system, "phase22/provider-files-upload", provider);
            var pipelineContext = CreatePipeline(system, provider, registry);
            var pipeline = pipelineContext.Pipeline;

            var request = await CreateRequestAsync(
                pipelineContext.ArtifactStore,
                pipelineContext.BlobStore,
                requestId: "openai-upload",
                schemaRef: InvoiceSchemaRef,
                schemaJson: InvoiceSchemaJson,
                mimeType: "application/pdf",
                structuredJson: "unused",
                providerName: "openai",
                model: new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false),
                preferProviderFileUpload: true,
                inlineDataUrl: "data:application/pdf;base64,JVBERi0x");

            var first = await pipeline.ExtractAsync("phase22/openai-upload-worker-1", schemaActor, request);
            var second = await pipeline.ExtractAsync("phase22/openai-upload-worker-2", schemaActor, request);

            Assert.True(first.SchemaValidated);
            Assert.True(second.SchemaValidated);
            Assert.Equal("openai_responses_uploaded_file", first.TransportSummary);
            Assert.Equal("openai.responses:input_file:file_id", Assert.Single(first.Evidence).Locator);
            Assert.Equal(1, uploadCount);

            using var json = JsonDocument.Parse(responsesRequest!.Body);
            Assert.Equal("input_file", json.RootElement.GetProperty("input")[1].GetProperty("content")[0].GetProperty("type").GetString());
            Assert.Equal("file-openai-1", json.RootElement.GetProperty("input")[1].GetProperty("content")[0].GetProperty("file_id").GetString());
        });
    }

    [Fact]
    public async Task OpenAiResponses_ImageExtraction_UsesInputImageDataUrl_AndReturnsValidatedEvidence()
    {
        CapturedHttpRequest? capturedRequest = null;
        var provider = CreateHttpProvider((request, _) =>
        {
            capturedRequest = CapturedHttpRequest.From(request);
            return JsonResponse(new
            {
                id = "resp_img_extract",
                status = "completed",
                model = "gpt-4.1",
                output = new object[]
                {
                    new { content = new object[] { new { type = "output_text", text = "{\"statementId\":\"STMT-OAI\",\"transactionReference\":\"TX-OAI\"}" } } }
                },
                usage = new { input_tokens = 9, output_tokens = 4, total_tokens = 13 }
            });
        }, protocol: "openai.responses", providerName: "openai", model: "gpt-4.1");

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-openai-image-schema");
            await RegisterSchema(schemaActor, StatementSchemaRef, StatementSchemaJson);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var result = await pipeline.ExtractAsync(
                "phase22/openai-image-worker",
                schemaActor,
                await CreateRequestAsync(
                    pipelineContext.ArtifactStore,
                    pipelineContext.BlobStore,
                    requestId: "openai-image",
                    schemaRef: StatementSchemaRef,
                    schemaJson: StatementSchemaJson,
                    mimeType: "image/png",
                    structuredJson: "unused",
                    providerName: "openai",
                    inlineDataUrl: "data:image/png;base64,AAEC"));

            Assert.True(result.SchemaValidated);
            Assert.Equal("openai_responses_input_image_data_url", result.TransportSummary);
            Assert.Equal("openai.responses:input_image:data_url", Assert.Single(result.Evidence).Locator);

            using var json = JsonDocument.Parse(capturedRequest!.Body);
            Assert.Equal("input_image", json.RootElement.GetProperty("input")[1].GetProperty("content")[0].GetProperty("type").GetString());
            Assert.Equal("data:image/png;base64,AAEC", json.RootElement.GetProperty("input")[1].GetProperty("content")[0].GetProperty("image_url").GetString());
        });
    }

    [Fact]
    public async Task ExtractionPipeline_ProviderMalformedJson_ReturnsStableFailureResult()
    {
        var provider = CreateHttpProvider((_, _) => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{not-json", Encoding.UTF8, "application/json")
        });

        await WithSystem(async system =>
        {
            var schemaActor = CreateSchemaRegistry(system, "phase22-malformed-provider-schema");
            await RegisterSchema(schemaActor, InvoiceSchemaRef, InvoiceSchemaJson);

            var pipelineContext = CreatePipeline(system, provider, new InMemoryProviderFileRegistry());
            var pipeline = pipelineContext.Pipeline;
            var result = await pipeline.ExtractAsync(
                "phase22/malformed-provider-worker",
                schemaActor,
                await CreateRequestAsync(
                    pipelineContext.ArtifactStore,
                    pipelineContext.BlobStore,
                    requestId: "malformed-provider",
                    schemaRef: InvoiceSchemaRef,
                    schemaJson: InvoiceSchemaJson,
                    mimeType: "application/pdf",
                    structuredJson: "unused"));

            Assert.False(result.SchemaValidated);
            Assert.Contains(result.ValidationErrors, error => error.Contains("Provider response body was not valid JSON", StringComparison.Ordinal));
            Assert.Equal("provider_file", result.TransportSummary);
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        return Task.CompletedTask;
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

        var system = ActorSystem.Create($"aven-phase22-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static IActorRef CreateSchemaRegistry(ActorSystem system, string persistenceId) =>
        system.ActorOf(Props.Create(() => new SchemaRegistryActor(persistenceId)), persistenceId.Replace('/', '-'));

    private static async Task RegisterSchema(IActorRef schemaActor, SchemaRef schemaRef, string jsonSchema)
    {
        _ = await schemaActor.Ask<object>(new SchemaRegister(schemaRef, jsonSchema, schemaRef.Value), TimeSpan.FromSeconds(3));
    }

    private static async Task<LlmExtractionRequest> CreateRequestAsync(
        IArtifactStore artifactStore,
        IArtifactBlobStore blobStore,
        string requestId,
        SchemaRef schemaRef,
        string schemaJson,
        string mimeType,
        string structuredJson,
        bool allowTextFallback = false,
        LlmModelCapabilities? model = null,
        string? inlineText = null,
        string providerName = "stub-http",
        bool preferProviderFileUpload = false,
        string? inlineDataUrl = null)
    {
        var effectiveModel = model ?? new LlmModelCapabilities("stub-model", true, true, true, true, true, false);
        var bytes = inlineDataUrl is not null
            ? Convert.FromBase64String(inlineDataUrl[(inlineDataUrl.IndexOf(",", StringComparison.Ordinal) + 1)..])
            : Encoding.UTF8.GetBytes(inlineText ?? structuredJson);
        var blob = await blobStore.PutAsync(mimeType, bytes);
        var artifact = await artifactStore.CreateArtifactAsync($"artifact-{requestId}.{InferExtension(mimeType)}", mimeType, "test", blob, null, CancellationToken.None);
        InMemoryLlmProvider.Configure(requestId, new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.StructuredSuccess, StructuredJson: structuredJson));
        return new LlmExtractionRequest(
            new OperationKey(new ActorAddress("agent/accountant", "local"), new RequestId(requestId), "llm.extract"),
            new CorrelationId($"corr-{requestId}"),
            artifact,
            providerName,
            effectiveModel,
            "accounting.extract",
            schemaRef,
            schemaJson,
            $"Extract {schemaRef.Value}",
            allowTextFallback,
            preferProviderFileUpload,
            null);
    }

    private static (LlmExtractionPipeline Pipeline, SqliteArtifactStore ArtifactStore, ToolkitFileSystemArtifactBlobStore BlobStore) CreatePipeline(
        ActorSystem system,
        ILlmProvider provider,
        IProviderFileRegistry registry)
    {
        var root = Path.Combine(Path.GetTempPath(), $"aven-phase22-artifacts-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var sqlitePath = Path.Combine(root, "artifacts.sqlite");
        var blobRoot = Path.Combine(root, "blobs");
        var artifactStore = new SqliteArtifactStore($"Data Source={sqlitePath}");
        var blobStore = new ToolkitFileSystemArtifactBlobStore(blobRoot);
        var pipeline = new LlmExtractionPipeline(system, provider, artifactStore, blobStore, new LlmInputPreparer(registry));
        return (pipeline, artifactStore, blobStore);
    }

    private static string InferExtension(string mimeType) =>
        mimeType switch
        {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "application/json" => "json",
            _ => "bin"
        };

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
            new LlmProviderConfiguration(providerName, "http://localhost", "stub-token", model, true, protocol));
    }

    private static HttpResponseMessage JsonResponse(object payload) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
    };

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

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

    private static readonly SchemaRef InvoiceSchemaRef = new("schema://accounting/invoice-extraction@1");
    private static readonly SchemaRef StatementSchemaRef = new("schema://accounting/account-statement-extraction@1");
    private const string InvoiceSchemaJson = "{\"type\":\"object\",\"required\":[\"invoiceNumber\"],\"properties\":{\"invoiceNumber\":{\"type\":\"string\"},\"vendor\":{\"type\":\"string\"}}}";
    private const string InvoiceSchemaV2Json = "{\"type\":\"object\",\"required\":[\"invoiceNumber\",\"currency\"],\"properties\":{\"invoiceNumber\":{\"type\":\"string\"},\"currency\":{\"type\":\"string\"}}}";
    private const string StatementSchemaJson = "{\"type\":\"object\",\"required\":[\"statementId\"],\"properties\":{\"statementId\":{\"type\":\"string\"},\"transactionReference\":{\"type\":\"string\"}}}";
}