using Akka.Actor;
using Akka.Configuration;
using RuntimeArtifactId = Aven.Toolkit.Core.Identifiers.ArtifactId;
using ToolkitArtifactRef = Aven.Toolkit.Artifacts.ArtifactRef;
using ToolkitBlobRef = Aven.Toolkit.Artifacts.BlobRef;
using ToolkitArtifactId = Aven.Toolkit.Core.Identifiers.ArtifactId;
using ToolkitArtifactRevisionId = Aven.Toolkit.Core.Identifiers.ArtifactRevisionId;

namespace Aven.Tests.Resources;

public sealed class Phase19LlmInputPreparationTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase19-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public void PdfArtifact_WithProviderFileSupport_UsesProviderFileAndReusesByHashPurposeProvider()
    {
        var registry = new InMemoryProviderFileRegistry();
        var service = new LlmInputPreparer(registry);
        var model = new LlmModelCapabilities("stub-model", true, false, true, true, true, false);
        var artifact = CreateArtifact("artifact/pdf", "revision/1", "application/pdf", "hash-pdf-1");

        var first = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "accounting.extract"));
        var second = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "accounting.extract"));

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        var firstPrepared = Assert.IsType<PreparedLlmInput>(first.Prepared);
        var secondPrepared = Assert.IsType<PreparedLlmInput>(second.Prepared);
        var firstBlock = Assert.IsType<ProviderFileInputBlock>(Assert.Single(firstPrepared.Input));
        var secondBlock = Assert.IsType<ProviderFileInputBlock>(Assert.Single(secondPrepared.Input));
        Assert.Equal(firstBlock.ProviderFileKey, secondBlock.ProviderFileKey);
        Assert.Equal("provider_file", firstPrepared.TransportSummary);
        Assert.Equal(artifact.Artifact.ArtifactId.Value, Assert.Single(firstPrepared.ProviderFiles).ArtifactId.Value);
    }

    [Fact]
    public void ImageArtifact_WithImageSupport_UsesImageArtifactBlock()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("vision-model", true, false, false, true, true, false);
        var artifact = CreateArtifact("artifact/image", "revision/1", "image/png", "hash-image-1");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "route.classify"));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        var block = Assert.IsType<ArtifactInputBlock>(Assert.Single(prepared.Input));
        Assert.Equal(LlmBlockKind.ImageArtifact, block.ArtifactKind);
        Assert.Equal("image_artifact", prepared.TransportSummary);
        Assert.Empty(prepared.Degradations);
    }

    [Fact]
    public void UnsupportedArtifactType_IsRejectedBeforeProviderCall()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("stub-model", true, true, true, true, true, false);
        var artifact = CreateArtifact("artifact/bin", "revision/1", "application/octet-stream", "hash-bin-1");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "accounting.extract"));

        Assert.False(result.IsSuccess);
        var error = Assert.IsType<OperationError>(result.Error);
        Assert.Equal("unsupported_artifact_type", error.Code);
    }

    [Fact]
    public void PdfArtifact_TextFallback_RecordsExplicitDegradation()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("text-only-model", false, false, false, true, true, false);
        var artifact = CreateArtifact(
            "artifact/pdf",
            "revision/2",
            "application/pdf",
            "hash-pdf-2",
            inlineText: "Invoice INV-200 total 42.00");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest(
            "stub-http",
            null,
            model,
            artifact,
            "accounting.extract",
            AllowTextFallback: true));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        var block = Assert.IsType<TextInputBlock>(Assert.Single(prepared.Input));
        Assert.Equal("Invoice INV-200 total 42.00", block.Text);
        Assert.Equal("text_fallback_pdf", Assert.Single(prepared.Degradations).Code);
        Assert.Equal(artifact.Artifact.RevisionId, prepared.SourceArtifact.Artifact.RevisionId);
    }

    [Fact]
    public void ProviderFileReuse_IsScopedByPurposeAndProvider()
    {
        var registry = new InMemoryProviderFileRegistry();
        var service = new LlmInputPreparer(registry);
        var model = new LlmModelCapabilities("stub-model", true, false, true, true, true, false);
        var artifact = CreateArtifact("artifact/pdf", "revision/3", "application/pdf", "hash-pdf-3");

        var providerA = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("provider-a", null, model, artifact, "extract.invoice"));
        var providerB = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("provider-b", null, model, artifact, "extract.invoice"));
        var purposeB = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("provider-a", null, model, artifact, "route.classify"));

        var keyA = Assert.IsType<ProviderFileInputBlock>(Assert.Single(providerA.Prepared!.Input)).ProviderFileKey;
        var keyB = Assert.IsType<ProviderFileInputBlock>(Assert.Single(providerB.Prepared!.Input)).ProviderFileKey;
        var keyPurposeB = Assert.IsType<ProviderFileInputBlock>(Assert.Single(purposeB.Prepared!.Input)).ProviderFileKey;

        Assert.NotEqual(keyA, keyB);
        Assert.NotEqual(keyA, keyPurposeB);
    }

    [Fact]
    public void PdfArtifact_WithOpenAiResponsesAndPreferredUpload_UsesUploadedFileTransport()
    {
        var registry = new InMemoryProviderFileRegistry();
        var service = new LlmInputPreparer(registry);
        var model = new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false);
        var artifact = CreateArtifact(
            "artifact/pdf-openai-upload",
            "revision/openai-upload",
            "application/pdf",
            "hash-pdf-openai-upload",
            inlineDataUrl: "data:application/pdf;base64,JVBERi0x");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest(
            "openai",
            "openai.responses",
            model,
            artifact,
            "accounting.extract",
            PreferProviderFileUpload: true));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        var block = Assert.IsType<ProviderFileInputBlock>(Assert.Single(prepared.Input));
        Assert.Equal("openai_responses_uploaded_file", prepared.TransportSummary);
        Assert.Equal("openai.responses.file_id", block.TransportMode);
        Assert.Single(prepared.ProviderFiles);
    }

    [Fact]
    public void PdfArtifact_WithOpenAiResponsesDataUrlAndNoPreferredUpload_UsesInputFileDataUrl()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false);
        var artifact = CreateArtifact(
            "artifact/pdf-openai-data-url",
            "revision/openai-data-url",
            "application/pdf",
            "hash-pdf-openai-data-url",
            inlineDataUrl: "data:application/pdf;base64,JVBERi0x");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest(
            "openai",
            "openai.responses",
            model,
            artifact,
            "accounting.extract"));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        var block = Assert.IsType<ArtifactInputBlock>(Assert.Single(prepared.Input));
        Assert.Equal(LlmBlockKind.DocumentArtifact, block.ArtifactKind);
        Assert.Equal("openai_responses_input_file_data_url", prepared.TransportSummary);
        Assert.Equal("data:application/pdf;base64,JVBERi0x", block.InlineTransportData);
        Assert.Empty(prepared.ProviderFiles);
    }

    [Fact]
    public void PdfArtifact_WithoutProviderSupportOrFallback_IsRejectedAsUnsupportedDocumentArtifact()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("text-only-model", false, false, false, true, true, false);
        var artifact = CreateArtifact("artifact/pdf-unsupported", "revision/pdf-unsupported", "application/pdf", "hash-pdf-unsupported");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "accounting.extract"));

        Assert.False(result.IsSuccess);
        Assert.Equal("unsupported_document_artifact", Assert.IsType<OperationError>(result.Error).Code);
    }

    [Fact]
    public void ImageArtifact_WithOpenAiResponsesDataUrl_UsesInputImageDataUrl()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false);
        var artifact = CreateArtifact(
            "artifact/image-openai-data-url",
            "revision/image-openai-data-url",
            "image/png",
            "hash-image-openai-data-url",
            inlineDataUrl: "data:image/png;base64,AAEC");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest(
            "openai",
            "openai.responses",
            model,
            artifact,
            "route.classify"));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        var block = Assert.IsType<ArtifactInputBlock>(Assert.Single(prepared.Input));
        Assert.Equal(LlmBlockKind.ImageArtifact, block.ArtifactKind);
        Assert.Equal("openai_responses_input_image_data_url", prepared.TransportSummary);
        Assert.Equal("data:image/png;base64,AAEC", block.InlineTransportData);
    }

    [Fact]
    public void ImageArtifact_WithoutImageSupportOrFallback_IsRejectedAsUnsupportedImageArtifact()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("text-only-model", false, false, false, true, true, false);
        var artifact = CreateArtifact("artifact/image-unsupported", "revision/image-unsupported", "image/png", "hash-image-unsupported");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "route.classify"));

        Assert.False(result.IsSuccess);
        Assert.Equal("unsupported_image_artifact", Assert.IsType<OperationError>(result.Error).Code);
    }

    [Fact]
    public void ImageArtifact_TextFallback_RecordsExplicitDegradation()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("text-only-model", false, false, false, true, true, false);
        var artifact = CreateArtifact(
            "artifact/image-fallback",
            "revision/image-fallback",
            "image/png",
            "hash-image-fallback",
            inlineText: "Receipt snapshot OCR text");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest(
            "stub-http",
            null,
            model,
            artifact,
            "route.classify",
            AllowTextFallback: true));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        Assert.Equal("text_fallback_image", Assert.Single(prepared.Degradations).Code);
    }

    [Fact]
    public async Task PdfArtifact_OpenAiPreferredUpload_HasSyncAsyncPreparationParity()
    {
        var registry = new InMemoryProviderFileRegistry();
        var service = new LlmInputPreparer(registry);
        var model = new LlmModelCapabilities("gpt-4.1", true, true, true, true, true, false);
        var artifact = CreateArtifact(
            "artifact/pdf-openai-parity",
            "revision/openai-parity",
            "application/pdf",
            "hash-pdf-openai-parity",
            inlineDataUrl: "data:application/pdf;base64,JVBERi0x");
        var request = new LlmArtifactPreparationRequest(
            "openai",
            "openai.responses",
            model,
            artifact,
            "accounting.extract",
            PreferProviderFileUpload: true);

        var syncResult = service.PrepareArtifactInput(request);
        var asyncResult = await service.PrepareArtifactInputAsync(request);

        var syncPrepared = Assert.IsType<PreparedLlmInput>(syncResult.Prepared);
        var asyncPrepared = Assert.IsType<PreparedLlmInput>(asyncResult.Prepared);
        Assert.Equal(syncPrepared.TransportSummary, asyncPrepared.TransportSummary);
        Assert.Equal(
            Assert.IsType<ProviderFileInputBlock>(Assert.Single(syncPrepared.Input)).TransportMode,
            Assert.IsType<ProviderFileInputBlock>(Assert.Single(asyncPrepared.Input)).TransportMode);
        Assert.Equal(
            Assert.Single(syncPrepared.ProviderFiles).ProviderFileKey,
            Assert.Single(asyncPrepared.ProviderFiles).ProviderFileKey);
    }

    [Fact]
    public async Task ActorBackedProviderFileReuse_SurvivesRestart_ForSameProviderHashPurposeAndTransport()
    {
        var artifact = CreateArtifact("artifact/pdf", "revision/4", "application/pdf", "hash-pdf-4");
        ProviderFileKey firstKey = default;

        await WithSystem(system =>
        {
            var registry = new ActorBackedProviderFileRegistry(system, "phase19/provider-files");
            var descriptor = registry.GetOrCreate("openai", artifact, "accounting.extract", "provider_file");
            firstKey = descriptor.ProviderFileKey;
            return Task.CompletedTask;
        });

        await WithSystem(system =>
        {
            var registry = new ActorBackedProviderFileRegistry(system, "phase19/provider-files");
            var descriptor = registry.GetOrCreate("openai", artifact, "accounting.extract", "provider_file");
            Assert.Equal(firstKey, descriptor.ProviderFileKey);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ActorBackedProviderFileReuse_SurvivesRestart_ForRemoteOpenAiFileId()
    {
        var artifact = new ArtifactSourceDescriptor(
            new ToolkitArtifactRef(new ToolkitArtifactId("artifact/pdf-remote"), new ToolkitArtifactRevisionId("revision/remote")),
            "artifact-pdf-remote.pdf",
            "application/pdf",
            new ToolkitBlobRef("sha256", "hash-pdf-remote", 8),
            null,
            InlineDataUrl: "data:application/pdf;base64,JVBERi0x");

        var uploader = new FakeUploader();
        ProviderFileKey firstKey = default;

        await WithSystem(system =>
        {
            var registry = new ActorBackedProviderFileRegistry(system, "phase19/provider-files-remote", uploader);
            var descriptor = registry.GetOrCreate("openai", artifact, "accounting.extract", "openai.responses.file_id");
            firstKey = descriptor.ProviderFileKey;
            Assert.Equal("uploaded-file-1", firstKey.Value);
            return Task.CompletedTask;
        });

        await WithSystem(system =>
        {
            var registry = new ActorBackedProviderFileRegistry(system, "phase19/provider-files-remote", uploader);
            var descriptor = registry.GetOrCreate("openai", artifact, "accounting.extract", "openai.responses.file_id");
            Assert.Equal(firstKey, descriptor.ProviderFileKey);
            Assert.Equal(1, uploader.UploadCount);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public void TextArtifact_WithInlineText_UsesTextBlock()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("text-model", true, false, false, true, true, false);
        var artifact = CreateArtifact("artifact/text", "revision/text", "text/plain", "hash-text", inlineText: "plain text body");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "notes.read"));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        var block = Assert.IsType<TextInputBlock>(Assert.Single(prepared.Input));
        Assert.Equal("plain text body", block.Text);
        Assert.Equal("inline_text", prepared.TransportSummary);
    }

    [Fact]
    public void TextArtifact_MissingInlineText_IsRejected()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("text-model", true, false, false, true, true, false);
        var artifact = CreateArtifact("artifact/text-missing", "revision/text-missing", "text/plain", "hash-text-missing");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "notes.read"));

        Assert.False(result.IsSuccess);
        Assert.Equal("missing_text_content", Assert.IsType<OperationError>(result.Error).Code);
    }

    [Fact]
    public void JsonArtifact_WithInlineJson_UsesJsonBlock()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("json-model", true, false, false, true, true, false);
        var artifact = CreateArtifact("artifact/json", "revision/json", "application/json", "hash-json", inlineText: "{\"ok\":true}");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "json.read"));

        Assert.True(result.IsSuccess);
        var prepared = Assert.IsType<PreparedLlmInput>(result.Prepared);
        var block = Assert.IsType<JsonInputBlock>(Assert.Single(prepared.Input));
        Assert.Equal("{\"ok\":true}", block.Json);
        Assert.Equal("inline_json", prepared.TransportSummary);
    }

    [Fact]
    public void JsonArtifact_MissingInlineJson_IsRejected()
    {
        var service = new LlmInputPreparer(new InMemoryProviderFileRegistry());
        var model = new LlmModelCapabilities("json-model", true, false, false, true, true, false);
        var artifact = CreateArtifact("artifact/json-missing", "revision/json-missing", "application/json", "hash-json-missing");

        var result = service.PrepareArtifactInput(new LlmArtifactPreparationRequest("stub-http", null, model, artifact, "json.read"));

        Assert.False(result.IsSuccess);
        Assert.Equal("missing_json_content", Assert.IsType<OperationError>(result.Error).Code);
    }

    private static ArtifactSourceDescriptor CreateArtifact(
        string artifactId,
        string revisionId,
        string mimeType,
        string contentHash,
        string? inlineText = null,
        string? inlineDataUrl = null) =>
        new(
            new ToolkitArtifactRef(new ToolkitArtifactId(artifactId), new ToolkitArtifactRevisionId(revisionId)),
            $"{artifactId}.{InferExtension(mimeType)}",
            mimeType,
            new ToolkitBlobRef("sha256", contentHash, inlineText?.Length ?? 0),
            inlineText,
            inlineDataUrl);

    private static string InferExtension(string mimeType) =>
        mimeType switch
        {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "application/json" => "json",
            _ => "bin"
        };

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

        var system = ActorSystem.Create($"aven-phase19-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private sealed class FakeUploader : IProviderFileUploader
    {
        public int UploadCount { get; private set; }

        public Task<ProviderFileDescriptor> UploadProviderFileAsync(ArtifactSourceDescriptor artifact, string purpose, string transportMode, CancellationToken cancellationToken = default) =>
            Task.FromResult(UploadProviderFile(artifact, purpose, transportMode));

        public ProviderFileDescriptor UploadProviderFile(ArtifactSourceDescriptor artifact, string purpose, string transportMode)
        {
            UploadCount++;
            return new ProviderFileDescriptor(new ProviderFileKey($"uploaded-file-{UploadCount}"), new RuntimeArtifactId(artifact.Artifact.ArtifactId.Value), purpose, transportMode);
        }
    }
}