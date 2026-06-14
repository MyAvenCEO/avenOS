namespace Aven.Resources.Llm.Preparation;

public sealed class LlmInputPreparer
{
    private readonly IProviderFileRegistry _providerFileRegistry;

    public LlmInputPreparer(IProviderFileRegistry providerFileRegistry)
    {
        _providerFileRegistry = providerFileRegistry;
    }

    public Task<LlmArtifactPreparationResult> PrepareArtifactInputAsync(LlmArtifactPreparationRequest request, CancellationToken cancellationToken = default)
    {
        var artifactKind = Classify(request.Artifact.MimeType);
        return artifactKind switch
        {
            LlmPreparedArtifactKind.Pdf => PreparePdfAsync(request, cancellationToken),
            _ => Task.FromResult(PrepareArtifactInput(request))
        };
    }

    public LlmArtifactPreparationResult PrepareArtifactInput(LlmArtifactPreparationRequest request)
    {
        var artifactKind = Classify(request.Artifact.MimeType);
        return artifactKind switch
        {
            LlmPreparedArtifactKind.Pdf => PreparePdf(request),
            LlmPreparedArtifactKind.Image => PrepareImage(request),
            LlmPreparedArtifactKind.Text => PrepareText(request),
            LlmPreparedArtifactKind.Json => PrepareJson(request),
            _ => LlmArtifactPreparationResult.Rejected(new OperationError(
                "unsupported_artifact_type",
                $"Artifact MIME type '{request.Artifact.MimeType}' is not supported for LLM input preparation.",
                false))
        };
    }

    private async Task<LlmArtifactPreparationResult> PreparePdfAsync(LlmArtifactPreparationRequest request, CancellationToken cancellationToken)
    {
        var decision = DecidePdfTransport(request);
        switch (decision)
        {
            case PdfTransportDecision.OpenAiResponsesUploadedFile:
                {
                    var providerFile = await _providerFileRegistry.GetOrCreateAsync(request.ProviderName, request.Artifact, request.Purpose, "openai.responses.file_id", cancellationToken);
                    return SuccessWithProviderFile(request, providerFile, "openai.responses.file_id", "openai_responses_uploaded_file");
                }
            case PdfTransportDecision.ProviderFile:
                {
                    var providerFile = await _providerFileRegistry.GetOrCreateAsync(request.ProviderName, request.Artifact, request.Purpose, "provider_file", cancellationToken);
                    return SuccessWithProviderFile(request, providerFile, "provider_file", "provider_file");
                }
            default:
                return PreparePdf(request, decision);
        }
    }

    private LlmArtifactPreparationResult PreparePdf(LlmArtifactPreparationRequest request)
        => PreparePdf(request, DecidePdfTransport(request));

    private LlmArtifactPreparationResult PreparePdf(LlmArtifactPreparationRequest request, PdfTransportDecision decision)
    {
        switch (decision)
        {
            case PdfTransportDecision.OpenAiResponsesUploadedFile:
                {
                    var providerFile = _providerFileRegistry.GetOrCreate(request.ProviderName, request.Artifact, request.Purpose, "openai.responses.file_id");
                    return SuccessWithProviderFile(request, providerFile, "openai.responses.file_id", "openai_responses_uploaded_file");
                }
            case PdfTransportDecision.OpenAiResponsesInputFileDataUrl:
                return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
                    new LlmInputBlock[] { new ArtifactInputBlock(LlmBlockKind.DocumentArtifact, new ArtifactId(request.Artifact.Artifact.ArtifactId.Value), request.Artifact.MimeType, request.Artifact.InlineDataUrl) },
                    Array.Empty<ProviderFileDescriptor>(),
                    Array.Empty<LlmProviderDegradation>(),
                    request.Artifact,
                    "openai_responses_input_file_data_url"));
            case PdfTransportDecision.ProviderFile:
                {
                    var providerFile = _providerFileRegistry.GetOrCreate(request.ProviderName, request.Artifact, request.Purpose, "provider_file");
                    return SuccessWithProviderFile(request, providerFile, "provider_file", "provider_file");
                }
        }

        if (request.Model.SupportsPdfArtifacts)
        {
            return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
                new LlmInputBlock[] { new ArtifactInputBlock(LlmBlockKind.DocumentArtifact, new ArtifactId(request.Artifact.Artifact.ArtifactId.Value), request.Artifact.MimeType) },
                Array.Empty<ProviderFileDescriptor>(),
                Array.Empty<LlmProviderDegradation>(),
                request.Artifact,
                "document_artifact"));
        }

        if (request.AllowTextFallback && !string.IsNullOrWhiteSpace(request.Artifact.InlineText))
        {
            return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
                new LlmInputBlock[] { new TextInputBlock(request.Artifact.InlineText!) },
                Array.Empty<ProviderFileDescriptor>(),
                new[]
                {
                    new LlmProviderDegradation(
                        "text_fallback_pdf",
                        "PDF artifact was downgraded to inline text because provider-native document transport is unavailable.")
                },
                request.Artifact,
                request.TextFallbackTransportMode));
        }

        return LlmArtifactPreparationResult.Rejected(new OperationError(
            "unsupported_document_artifact",
            "Model/provider cannot accept PDF artifacts and no explicit text fallback is available.",
            false));
    }

    private static LlmArtifactPreparationResult SuccessWithProviderFile(
        LlmArtifactPreparationRequest request,
        ProviderFileDescriptor providerFile,
        string transportMode,
        string transportSummary) =>
        LlmArtifactPreparationResult.Success(new PreparedLlmInput(
            new LlmInputBlock[] { new ProviderFileInputBlock(providerFile.ProviderFileKey, request.Purpose, transportMode) },
            new[] { providerFile },
            Array.Empty<LlmProviderDegradation>(),
            request.Artifact,
            transportSummary));

    private static PdfTransportDecision DecidePdfTransport(LlmArtifactPreparationRequest request)
    {
        var usesOpenAiResponses = UsesOpenAiResponses(request);
        var hasInlineDataUrl = !string.IsNullOrWhiteSpace(request.Artifact.InlineDataUrl);

        if (usesOpenAiResponses && request.PreferProviderFileUpload && request.Model.SupportsProviderFiles && hasInlineDataUrl)
        {
            return PdfTransportDecision.OpenAiResponsesUploadedFile;
        }

        if (usesOpenAiResponses && hasInlineDataUrl)
        {
            return PdfTransportDecision.OpenAiResponsesInputFileDataUrl;
        }

        if (request.Model.SupportsProviderFiles)
        {
            return PdfTransportDecision.ProviderFile;
        }

        return PdfTransportDecision.None;
    }

    private LlmArtifactPreparationResult PrepareImage(LlmArtifactPreparationRequest request)
    {
        if (UsesOpenAiResponses(request) && !string.IsNullOrWhiteSpace(request.Artifact.InlineDataUrl))
        {
            return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
                new LlmInputBlock[] { new ArtifactInputBlock(LlmBlockKind.ImageArtifact, new ArtifactId(request.Artifact.Artifact.ArtifactId.Value), request.Artifact.MimeType, request.Artifact.InlineDataUrl) },
                Array.Empty<ProviderFileDescriptor>(),
                Array.Empty<LlmProviderDegradation>(),
                request.Artifact,
                "openai_responses_input_image_data_url"));
        }

        if (request.Model.SupportsImages)
        {
            return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
                new LlmInputBlock[] { new ArtifactInputBlock(LlmBlockKind.ImageArtifact, new ArtifactId(request.Artifact.Artifact.ArtifactId.Value), request.Artifact.MimeType) },
                Array.Empty<ProviderFileDescriptor>(),
                Array.Empty<LlmProviderDegradation>(),
                request.Artifact,
                "image_artifact"));
        }

        if (request.AllowTextFallback && !string.IsNullOrWhiteSpace(request.Artifact.InlineText))
        {
            return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
                new LlmInputBlock[] { new TextInputBlock(request.Artifact.InlineText!) },
                Array.Empty<ProviderFileDescriptor>(),
                new[]
                {
                    new LlmProviderDegradation(
                        "text_fallback_image",
                        "Image artifact was downgraded to inline text because image transport is unavailable.")
                },
                request.Artifact,
                request.TextFallbackTransportMode));
        }

        return LlmArtifactPreparationResult.Rejected(new OperationError(
            "unsupported_image_artifact",
            "Model/provider cannot accept image artifacts and no explicit text fallback is available.",
            false));
    }

    private LlmArtifactPreparationResult PrepareText(LlmArtifactPreparationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Artifact.InlineText))
        {
            return LlmArtifactPreparationResult.Rejected(new OperationError(
                "missing_text_content",
                "Text artifact preparation requires inline text content.",
                false));
        }

        return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
            new LlmInputBlock[] { new TextInputBlock(request.Artifact.InlineText!) },
            Array.Empty<ProviderFileDescriptor>(),
            Array.Empty<LlmProviderDegradation>(),
            request.Artifact,
            "inline_text"));
    }

    private LlmArtifactPreparationResult PrepareJson(LlmArtifactPreparationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Artifact.InlineText))
        {
            return LlmArtifactPreparationResult.Rejected(new OperationError(
                "missing_json_content",
                "JSON artifact preparation requires inline JSON content.",
                false));
        }

        return LlmArtifactPreparationResult.Success(new PreparedLlmInput(
            new LlmInputBlock[] { new JsonInputBlock(request.Artifact.InlineText!) },
            Array.Empty<ProviderFileDescriptor>(),
            Array.Empty<LlmProviderDegradation>(),
            request.Artifact,
            "inline_json"));
    }

    private static LlmPreparedArtifactKind Classify(string mimeType)
    {
        if (mimeType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase))
        {
            return LlmPreparedArtifactKind.Pdf;
        }

        if (mimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return LlmPreparedArtifactKind.Image;
        }

        if (mimeType.Equals("application/json", StringComparison.OrdinalIgnoreCase))
        {
            return LlmPreparedArtifactKind.Json;
        }

        if (mimeType.StartsWith("text/", StringComparison.OrdinalIgnoreCase))
        {
            return LlmPreparedArtifactKind.Text;
        }

        return LlmPreparedArtifactKind.Unsupported;
    }

    private static bool UsesOpenAiResponses(LlmArtifactPreparationRequest request) =>
        string.Equals(request.AdapterProtocol, "openai.responses", StringComparison.OrdinalIgnoreCase);

    private enum PdfTransportDecision
    {
        None,
        OpenAiResponsesUploadedFile,
        OpenAiResponsesInputFileDataUrl,
        ProviderFile
    }
}
