using Akka.Actor;
using System.Text;
using Aven.Contracts.Protocol;

namespace Aven.Resources.Llm;

public sealed class LlmExtractionPipeline
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(180);
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    private readonly ActorSystem _system;
    private readonly ILlmProvider _provider;
    private readonly LlmInputPreparer _inputPreparation;
    private readonly IArtifactStore _artifactStore;
    private readonly IArtifactBlobStore _blobStore;

    public LlmExtractionPipeline(
        ActorSystem system,
        ILlmProvider provider,
        IArtifactStore artifactStore,
        IArtifactBlobStore blobStore,
        LlmInputPreparer inputPreparation)
    {
        _system = system;
        _provider = provider;
        _artifactStore = artifactStore;
        _blobStore = blobStore;
        _inputPreparation = inputPreparation;
    }

    public async Task<LlmExtractionResult> ExtractAsync(
        string workerPersistenceId,
        IActorRef schemaRegistry,
        LlmExtractionRequest request,
        CancellationToken cancellationToken = default)
    {
        var sourceArtifact = await ResolveArtifactAsync(request.SourceArtifact, cancellationToken);
        var preparation = await _inputPreparation.PrepareArtifactInputAsync(new LlmArtifactPreparationRequest(
            request.ProviderName,
            (_provider as HttpLlmProvider)?.Protocol,
            request.Model,
            sourceArtifact,
            request.Purpose,
            request.AllowTextFallback,
            request.PreferProviderFileUpload), cancellationToken);

        if (!preparation.IsSuccess || preparation.Prepared is null)
        {
            var error = preparation.Error ?? new OperationError("preparation_failed", "LLM input preparation failed.", false);
            return FailedResult(sourceArtifact, request, error, transportSummary: "preparation_rejected");
        }

        var prepared = preparation.Prepared;
        var llmRequest = new LlmRequest(
            request.Key,
            request.CorrelationId,
            ResourceAddresses.Gateway(ResourceKinds.Llm),
            new ActorAddress("reply/extraction", "local"),
            request.Model,
            BuildInputBlocks(request, prepared),
            new StructuredOutputContract(request.SchemaRef, request.SchemaJson, true),
            prepared.ProviderFiles,
            new LlmReasoningOptions(true, "small"),
            new LlmBudgetLimits(1.0m, 12000, 12000),
            new LlmSafetySettings(request.AllowTextFallback, true),
            request.CapabilityId);

        // Each invocation gets a unique worker identity. The worker is a one-shot, parent-reconstructed
        // request worker (recovery is owned by the gateway), so a stable name only causes "actor name is
        // not unique" collisions when a durable-delivery retry re-runs the same operation. The worker is
        // stopped after the result is obtained so it neither lingers nor collides with a later retry.
        var worker = CreateRequestWorker(workerPersistenceId, llmRequest);
        try
        {
            var reply = await worker.Ask<object>(new LlmProcessRequest(), DefaultTimeout, cancellationToken);
            if (reply is not LlmRequestSucceededReply success || success.Response.StructuredJson is null)
            {
                var error = reply switch
                {
                    LlmRequestRejectedReply rejected => rejected.Error,
                    LlmRequestFailedReply failed => failed.Error,
                    _ => new OperationError("llm_extraction_failed", $"Unexpected extraction reply: {reply.GetType().Name}", false)
                };

                return FailedResult(
                    sourceArtifact,
                    request,
                    error,
                    prepared.TransportSummary,
                    prepared.Degradations,
                    successResponse: (reply as LlmRequestSucceededReply)?.Response);
            }

            var validationReply = await schemaRegistry.Ask<object>(new SchemaValidate(request.SchemaRef, success.Response.StructuredJson), DefaultTimeout, cancellationToken);
            return validationReply switch
            {
                SchemaValidationSucceeded => SuccessfulResult(prepared, request, success.Response, Array.Empty<string>()),
                SchemaValidationFailed failed => FailedValidationResult(prepared, request, success.Response, failed.Errors),
                SchemaNotFound notFound => FailedResult(sourceArtifact, request, new OperationError("schema_not_found", $"Schema not found: {notFound.SchemaRef.Value}", false), prepared.TransportSummary, prepared.Degradations, success.Response),
                _ => FailedResult(sourceArtifact, request, new OperationError("schema_validation_failed", $"Unexpected schema validation reply: {validationReply.GetType().Name}", false), prepared.TransportSummary, prepared.Degradations, success.Response)
            };
        }
        finally
        {
            worker.Tell(PoisonPill.Instance);
        }
    }

    // Builds a one-shot request worker with a globally-unique actor name/persistenceId so concurrent
    // retries of the same operation never collide on the actor name.
    private IActorRef CreateRequestWorker(string workerPersistenceId, LlmRequest request)
    {
        var uniqueId = $"{workerPersistenceId.Replace('/', '-')}-{Guid.NewGuid():N}";
        return _system.ActorOf(
            Props.Create(() => new LlmRequestWorkerActor(uniqueId, request, _provider)),
            uniqueId);
    }

    public async Task<object> ProcessStructuredAsync(
        string workerPersistenceId,
        LlmRequest request,
        CancellationToken cancellationToken = default)
    {
        var worker = CreateRequestWorker(workerPersistenceId, request);
        try
        {
            return await worker.Ask<object>(new LlmProcessRequest(), DefaultTimeout, cancellationToken);
        }
        finally
        {
            worker.Tell(PoisonPill.Instance);
        }
    }

    private async Task<ArtifactSourceDescriptor> ResolveArtifactAsync(ArtifactRef artifactRef, CancellationToken cancellationToken)
    {
        var artifact = await _artifactStore.GetArtifactAsync(artifactRef.ArtifactId, cancellationToken)
            ?? throw new InvalidOperationException($"Artifact '{artifactRef.ArtifactId.Value}' was not found.");

        var runtimeArtifactRef = artifactRef.RevisionId is null
            ? new ArtifactRef(
                artifactRef.ArtifactId,
                artifact.CurrentRevisionId)
            : new ArtifactRef(
                artifactRef.ArtifactId,
                artifactRef.RevisionId);

        var revision = await _artifactStore.GetRevisionAsync(
            runtimeArtifactRef,
            cancellationToken)
            ?? throw new InvalidOperationException($"Artifact revision for '{artifactRef.ArtifactId.Value}' was not found.");

        var bytes = await _blobStore.GetAsync(revision.Blob, cancellationToken);
        var effectiveRef = new ArtifactRef(artifact.ArtifactId, revision.RevisionId);
        var blob = new BlobRef(revision.Blob.Algorithm, revision.Blob.Hash, revision.Blob.SizeBytes);
        var inlineText = TryDeriveInlineText(artifact.MimeType, bytes);
        var inlineDataUrl = $"data:{artifact.MimeType};base64,{Convert.ToBase64String(bytes)}";

        return new ArtifactSourceDescriptor(
            effectiveRef,
            artifact.Filename,
            artifact.MimeType,
            blob,
            inlineText,
            inlineDataUrl);
    }

    private static IReadOnlyList<LlmInputBlock> BuildInputBlocks(LlmExtractionRequest request, PreparedLlmInput prepared)
    {
        var prompt = new TextInputBlock(request.ExtractionPrompt);
        return new[] { prompt }.Concat(prepared.Input).ToArray();
    }

    private static LlmExtractionResult SuccessfulResult(
        PreparedLlmInput prepared,
        LlmExtractionRequest request,
        LlmResponse response,
        IReadOnlyList<string> validationErrors) =>
        new(
            request.Key,
            request.CorrelationId,
            prepared.SourceArtifact,
            response.Provider,
            response.Model,
            request.SchemaRef,
            response.StructuredJson ?? "{}",
            validationErrors.Count == 0,
            validationErrors,
            BuildEvidence(prepared),
            prepared.Degradations.Concat(response.Degradations).ToArray(),
            response.Usage,
            response.FinishReason,
            prepared.TransportSummary,
            request.ExtractionPrompt);

    private static LlmExtractionResult FailedValidationResult(
        PreparedLlmInput prepared,
        LlmExtractionRequest request,
        LlmResponse response,
        IReadOnlyList<string> errors) =>
        new(
            request.Key,
            request.CorrelationId,
            prepared.SourceArtifact,
            response.Provider,
            response.Model,
            request.SchemaRef,
            response.StructuredJson ?? "{}",
            false,
            errors,
            BuildEvidence(prepared),
            prepared.Degradations.Concat(response.Degradations).ToArray(),
            response.Usage,
            response.FinishReason,
            prepared.TransportSummary,
            request.ExtractionPrompt);

    private static LlmExtractionResult FailedResult(
        ArtifactSourceDescriptor sourceArtifact,
        LlmExtractionRequest request,
        OperationError error,
        string transportSummary,
        IReadOnlyList<LlmProviderDegradation>? degradations = null,
        LlmResponse? successResponse = null) =>
        new(
            request.Key,
            request.CorrelationId,
            sourceArtifact,
            successResponse?.Provider ?? request.ProviderName,
            successResponse?.Model ?? request.Model.ModelName,
            request.SchemaRef,
            successResponse?.StructuredJson ?? "{}",
            false,
            new[] { error.Message },
            Array.Empty<ExtractionEvidenceAnchor>(),
            degradations ?? Array.Empty<LlmProviderDegradation>(),
            successResponse?.Usage ?? new LlmUsage(0, 0, 0, 0m),
            successResponse?.FinishReason ?? error.Code,
            transportSummary,
            request.ExtractionPrompt);

    private static IReadOnlyList<ExtractionEvidenceAnchor> BuildEvidence(PreparedLlmInput prepared)
    {
        var degraded = prepared.Degradations.Count > 0;
        var locator = prepared.TransportSummary switch
        {
            "openai_responses_uploaded_file" => "openai.responses:input_file:file_id",
            "openai_responses_input_file_data_url" => "openai.responses:input_file:data_url",
            "openai_responses_input_image_data_url" => "openai.responses:input_image:data_url",
            "provider_file" => "provider-file:full-document",
            "document_artifact" => "document:full-artifact",
            "image_artifact" => "image:full-artifact",
            _ => "inline-text:derived-content"
        };

        return new[]
        {
            new ExtractionEvidenceAnchor(
                new ArtifactId(prepared.SourceArtifact.Artifact.ArtifactId.Value),
                new ArtifactRevisionId((prepared.SourceArtifact.Artifact.RevisionId ?? throw new InvalidOperationException("Prepared artifact source is missing a revision id.")).Value),
                prepared.SourceArtifact.MimeType,
                locator,
                degraded)
        };
    }

    private static bool CanInlineAsText(string mimeType) =>
        mimeType.StartsWith("text/", StringComparison.OrdinalIgnoreCase)
        || string.Equals(mimeType, "application/json", StringComparison.OrdinalIgnoreCase);

    private static string? TryDeriveInlineText(string mimeType, byte[] bytes)
    {
        if (bytes.Length == 0)
        {
            return string.Empty;
        }

        if (CanInlineAsText(mimeType))
        {
            return Encoding.UTF8.GetString(bytes);
        }

        try
        {
            var decoded = StrictUtf8.GetString(bytes);
            return LooksLikeDerivedText(decoded) ? decoded : null;
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }

    private static bool LooksLikeDerivedText(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var significant = 0;
        var readable = 0;

        foreach (var ch in value)
        {
            if (char.IsWhiteSpace(ch))
            {
                continue;
            }

            significant++;
            if (!char.IsControl(ch) || ch is '\r' or '\n' or '\t')
            {
                readable++;
            }
        }

        if (significant == 0)
        {
            return false;
        }

        return readable * 100 / significant >= 85;
    }
}