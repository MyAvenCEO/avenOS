using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Aven.Resources.Llm;

public sealed class HttpLlmProvider : ILlmProvider, IProviderFileUploader
{
    private readonly HttpClient _httpClient;
    private readonly LlmProviderConfiguration _configuration;

    public HttpLlmProvider(HttpClient httpClient, LlmProviderConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    public string Name => _configuration.ProviderName;

    public string? Protocol => _configuration.Protocol;

    public LlmProviderHealth GetHealth()
    {
        if (!_configuration.Enabled || string.IsNullOrWhiteSpace(_configuration.BaseUrl))
        {
            return new LlmProviderHealth(Name, false, false, "blocked_missing_provider", "Provider base URL is not configured.", _configuration.DefaultModel);
        }

        if (string.IsNullOrWhiteSpace(_configuration.ApiKey))
        {
            return new LlmProviderHealth(Name, false, false, "blocked_missing_provider", "Provider API key is not configured.", _configuration.DefaultModel);
        }

        return new LlmProviderHealth(Name, true, true, "ok", "Provider configuration is present.", _configuration.DefaultModel);
    }

    public async Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default)
    {
        var health = GetHealth();
        if (!health.IsHealthy)
        {
            throw new LlmProviderException(new OperationError(health.StatusCode, health.Message, false));
        }

        using var message = new HttpRequestMessage(HttpMethod.Post, BuildUri());
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _configuration.ApiKey);

        if (!UsesOpenAiResponsesProtocol())
        {
            message.Headers.Add("X-Aven-Provider", Name);
        }

        message.Content = new StringContent(JsonSerializer.Serialize(BuildPayload(request)), Encoding.UTF8, "application/json");

        using var response = await _httpClient.SendAsync(message, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new LlmProviderException(CreateHttpError(response.StatusCode, body));
        }

        using var document = ParseProviderJson(body, "provider_invalid_response", "Provider response body was not valid JSON.");
        return ParseResponse(request, document.RootElement);
    }

    public ProviderFileDescriptor UploadProviderFile(ArtifactSourceDescriptor artifact, string purpose, string transportMode)
        => UploadProviderFileAsync(artifact, purpose, transportMode).GetAwaiter().GetResult();

    public async Task<ProviderFileDescriptor> UploadProviderFileAsync(ArtifactSourceDescriptor artifact, string purpose, string transportMode, CancellationToken cancellationToken = default)
    {
        if (!UsesOpenAiResponsesProtocol())
        {
            throw new LlmProviderException(new OperationError("provider_file_upload_not_supported", "Remote provider-file upload is only implemented for the OpenAI Responses adapter path.", false));
        }

        if (string.IsNullOrWhiteSpace(artifact.InlineDataUrl))
        {
            throw new LlmProviderException(new OperationError("provider_file_upload_missing_data", "Provider-file upload requires inline data URL content.", false));
        }

        var health = GetHealth();
        if (!health.IsHealthy)
        {
            throw new LlmProviderException(new OperationError(health.StatusCode, health.Message, false));
        }

        using var message = new HttpRequestMessage(HttpMethod.Post, BuildFilesUri());
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _configuration.ApiKey);

        var (contentType, bytes) = ParseDataUrl(artifact.InlineDataUrl!);
        var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent("user_data"), "purpose");
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        multipart.Add(fileContent, "file", BuildFilename(artifact));
        message.Content = multipart;

        using var response = await _httpClient.SendAsync(message, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new LlmProviderException(CreateHttpError(response.StatusCode, body));
        }

        using var document = ParseProviderJson(body, "provider_file_upload_invalid_response", "Provider file upload response body was not valid JSON.");
        if (!document.RootElement.TryGetProperty("id", out var idElement) || idElement.ValueKind != JsonValueKind.String)
        {
            throw new LlmProviderException(new OperationError("provider_file_upload_invalid_response", "Provider file upload response did not contain a valid file id.", false));
        }

        var fileId = idElement.GetString();
        if (string.IsNullOrWhiteSpace(fileId))
        {
            throw new LlmProviderException(new OperationError("provider_file_upload_invalid_response", "Provider file upload response did not contain a valid file id.", false));
        }

        return new ProviderFileDescriptor(
            new ProviderFileKey(fileId),
            new ArtifactId(artifact.Artifact.ArtifactId.Value),
            purpose,
            transportMode);
    }

    private Uri BuildUri()
    {
        var baseUrl = _configuration.BaseUrl!.TrimEnd('/');
        return new Uri($"{baseUrl}/responses", UriKind.Absolute);
    }

    private Uri BuildFilesUri()
    {
        var baseUrl = _configuration.BaseUrl!.TrimEnd('/');
        return new Uri($"{baseUrl}/files", UriKind.Absolute);
    }

    private object BuildPayload(LlmRequest request)
    {
        if (UsesOpenAiResponsesProtocol())
        {
            return BuildOpenAiResponsesPayload(request);
        }

        return new
        {
            provider = Name,
            model = request.Model.ModelName,
            input = request.Input.Select(MapInput).ToArray(),
            structuredOutput = request.StructuredOutput is null
                ? null
                : new
                {
                    schemaRef = request.StructuredOutput.SchemaRef.Value,
                    jsonSchema = request.StructuredOutput.JsonSchema,
                    strict = request.StructuredOutput.Strict
                },
            reasoning = new
            {
                enableSummary = request.Reasoning.EnableReasoningSummary,
                thinkingBudget = request.Reasoning.ThinkingBudget
            },
            budget = new
            {
                maxCost = request.Budget.MaxCost,
                maxInputTokens = request.Budget.MaxInputTokens,
                maxOutputTokens = request.Budget.MaxOutputTokens
            },
            safety = new
            {
                allowPromptOnlyFallback = request.Safety.AllowPromptOnlyFallback,
                blockUnsafeContent = request.Safety.BlockUnsafeContent
            }
        };
    }

    private object BuildOpenAiResponsesPayload(LlmRequest request)
    {
        return new
        {
            model = request.Model.ModelName,
            input = request.Input.Select(MapOpenAiInput).ToArray(),
            text = request.StructuredOutput is null
                ? null
                : new
                {
                    format = new
                    {
                        type = "json_schema",
                        name = CreateSchemaName(request.StructuredOutput.SchemaRef),
                        schema = JsonDocument.Parse(request.StructuredOutput.JsonSchema).RootElement,
                        strict = request.StructuredOutput.Strict
                    }
                },
            reasoning = request.Reasoning.EnableReasoningSummary
                ? new
                {
                    summary = "auto"
                }
                : null,
            max_output_tokens = request.Budget.MaxOutputTokens
        };
    }

    private static object MapInput(LlmInputBlock block) => block switch
    {
        TextInputBlock text => new { kind = "text", role = text.Role, text = text.Text },
        JsonInputBlock json => new { kind = "json", role = json.Role, json = json.Json },
        ArtifactInputBlock artifact => new { kind = "artifact", artifactKind = artifact.ArtifactKind.ToString(), artifactId = artifact.ArtifactId.Value, mimeType = artifact.MimeType },
        ProviderFileInputBlock providerFile => new { kind = "provider_file", providerFileKey = providerFile.ProviderFileKey.Value, purpose = providerFile.Purpose, transportMode = providerFile.TransportMode },
        ToolDefinitionInputBlock tool => new { kind = "tool_definition", name = tool.Name, description = tool.Description, jsonSchema = tool.JsonSchema },
        ToolResultInputBlock toolResult => new { kind = "tool_result", toolName = toolResult.ToolName, resultJson = toolResult.ResultJson },
        _ => new { kind = block.Kind.ToString() }
    };

    private static object MapOpenAiInput(LlmInputBlock block) => block switch
    {
        TextInputBlock text => new
        {
            role = NormalizeRole(text.Role),
            content = new object[]
            {
                new { type = "input_text", text = text.Text }
            }
        },
        JsonInputBlock json => new
        {
            role = NormalizeRole(json.Role),
            content = new object[]
            {
                new { type = "input_text", text = json.Json }
            }
        },
        ProviderFileInputBlock providerFile => new
        {
            role = "user",
            content = new object[]
            {
                new { type = "input_file", file_id = providerFile.ProviderFileKey.Value }
            }
        },
        ToolResultInputBlock toolResult => new
        {
            role = "user",
            content = new object[]
            {
                new { type = "input_text", text = $"Tool result for {toolResult.ToolName}: {toolResult.ResultJson}" }
            }
        },
        ToolDefinitionInputBlock tool => new
        {
            role = "developer",
            content = new object[]
            {
                new { type = "input_text", text = $"Tool definition {tool.Name}: {tool.Description}\nSchema: {tool.JsonSchema}" }
            }
        },
        ArtifactInputBlock artifact when artifact.ArtifactKind == LlmBlockKind.ImageArtifact && !string.IsNullOrWhiteSpace(artifact.InlineTransportData) => new
        {
            role = "user",
            content = new object[]
            {
                new { type = "input_image", image_url = artifact.InlineTransportData }
            }
        },
        ArtifactInputBlock artifact when artifact.ArtifactKind == LlmBlockKind.DocumentArtifact && !string.IsNullOrWhiteSpace(artifact.InlineTransportData) => new
        {
            role = "user",
            content = new object[]
            {
                new { type = "input_file", filename = BuildFilename(artifact), file_data = artifact.InlineTransportData }
            }
        },
        ArtifactInputBlock artifact => throw new LlmProviderException(new OperationError(
            "openai_artifact_transport_not_implemented",
            $"Artifact block '{artifact.ArtifactKind}' requires provider-native file/data transport content that is not available on this request.",
            false)),
        _ => throw new LlmProviderException(new OperationError(
            "openai_input_not_supported",
            $"Input block kind '{block.Kind}' is not supported by the OpenAI adapter path.",
            false))
    };

    private LlmResponse ParseResponse(LlmRequest request, JsonElement root)
    {
        try
        {
            if (UsesOpenAiResponsesProtocol())
            {
                return ParseOpenAiResponse(request, root);
            }

            var provider = root.TryGetProperty("provider", out var providerElement) ? providerElement.GetString() ?? Name : Name;
            var model = root.TryGetProperty("model", out var modelElement) ? modelElement.GetString() ?? request.Model.ModelName : request.Model.ModelName;
            var text = root.TryGetProperty("text", out var textElement) && textElement.ValueKind != JsonValueKind.Null ? textElement.GetString() : null;
            var structuredJson = root.TryGetProperty("structuredJson", out var structuredElement) && structuredElement.ValueKind != JsonValueKind.Null ? structuredElement.GetRawText() : null;
            if (structuredElement.ValueKind == JsonValueKind.String)
            {
                structuredJson = structuredElement.GetString();
            }

            var refusal = root.TryGetProperty("refusal", out var refusalElement) && refusalElement.ValueKind != JsonValueKind.Null ? refusalElement.GetString() : null;
            var safetyBlock = root.TryGetProperty("safetyBlock", out var safetyElement) && safetyElement.ValueKind != JsonValueKind.Null ? safetyElement.GetString() : null;
            var reasoningSummary = root.TryGetProperty("reasoningSummary", out var reasoningElement) && reasoningElement.ValueKind != JsonValueKind.Null ? reasoningElement.GetString() : null;
            var finishReason = root.TryGetProperty("finishReason", out var finishElement) ? finishElement.GetString() ?? "stop" : "stop";
            var toolCalls = root.TryGetProperty("toolCalls", out var toolCallsElement) && toolCallsElement.ValueKind == JsonValueKind.Array
                ? toolCallsElement.EnumerateArray().Select(x => new LlmToolCall(
                    x.GetProperty("name").GetString() ?? string.Empty,
                    x.GetProperty("argumentsJson").GetString() ?? "{}")).ToArray()
                : Array.Empty<LlmToolCall>();
            var citations = root.TryGetProperty("citations", out var citationsElement) && citationsElement.ValueKind == JsonValueKind.Array
                ? citationsElement.EnumerateArray().Select(x => x.GetString() ?? string.Empty).ToArray()
                : Array.Empty<string>();
            var degradations = root.TryGetProperty("degradations", out var degradationElement) && degradationElement.ValueKind == JsonValueKind.Array
                ? degradationElement.EnumerateArray().Select(x => new LlmProviderDegradation(
                    x.GetProperty("code").GetString() ?? "unknown",
                    x.GetProperty("message").GetString() ?? string.Empty)).ToArray()
                : Array.Empty<LlmProviderDegradation>();
            var usage = root.TryGetProperty("usage", out var usageElement)
                ? new LlmUsage(
                    usageElement.GetProperty("promptTokens").GetInt32(),
                    usageElement.GetProperty("completionTokens").GetInt32(),
                    usageElement.GetProperty("totalTokens").GetInt32(),
                    usageElement.GetProperty("cost").GetDecimal())
                : new LlmUsage(0, 0, 0, 0m);

            var validated = HasStructuredOutput(request, structuredJson);

            return new LlmResponse(
                provider,
                model,
                text,
                structuredJson,
                toolCalls,
                refusal,
                safetyBlock,
                reasoningSummary,
                citations,
                usage,
                finishReason,
                degradations,
                request.StructuredOutput?.SchemaRef,
                validated);
        }
        catch (LlmProviderException)
        {
            throw;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            throw new LlmProviderException(new OperationError("provider_invalid_response", $"Provider response could not be parsed: {ex.Message}", false));
        }
    }

    private LlmResponse ParseOpenAiResponse(LlmRequest request, JsonElement root)
    {
        try
        {
            var model = root.TryGetProperty("model", out var modelElement) ? modelElement.GetString() ?? request.Model.ModelName : request.Model.ModelName;
            var finishReason = root.TryGetProperty("status", out var statusElement) ? statusElement.GetString() ?? "completed" : "completed";

            var text = root.TryGetProperty("output_text", out var outputTextElement) && outputTextElement.ValueKind == JsonValueKind.String
                ? outputTextElement.GetString()
                : ExtractOpenAiOutputText(root);

            var refusal = ExtractOpenAiRefusal(root);
            var structuredJson = request.StructuredOutput is not null ? text : null;
            var citations = Array.Empty<string>();
            var degradations = Array.Empty<LlmProviderDegradation>();
            var toolCalls = Array.Empty<LlmToolCall>();

            var usage = root.TryGetProperty("usage", out var usageElement)
                ? new LlmUsage(
                    usageElement.TryGetProperty("input_tokens", out var promptTokens) ? promptTokens.GetInt32() : 0,
                    usageElement.TryGetProperty("output_tokens", out var completionTokens) ? completionTokens.GetInt32() : 0,
                    usageElement.TryGetProperty("total_tokens", out var totalTokens) ? totalTokens.GetInt32() : 0,
                    0m)
                : new LlmUsage(0, 0, 0, 0m);

            var validated = HasStructuredOutput(request, structuredJson);

            return new LlmResponse(
                Name,
                model,
                request.StructuredOutput is null ? text : null,
                structuredJson,
                toolCalls,
                refusal,
                null,
                null,
                citations,
                usage,
                finishReason,
                degradations,
                request.StructuredOutput?.SchemaRef,
                validated);
        }
        catch (LlmProviderException)
        {
            throw;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            throw new LlmProviderException(new OperationError("provider_invalid_response", $"Provider response could not be parsed: {ex.Message}", false));
        }
    }

    // Provider-level structured output validation is intentionally limited to transport/syntax checks.
    // Authoritative schema validation is performed by the schema registry via SchemaValidate.
    private static bool HasStructuredOutput(LlmRequest request, string? structuredJson)
    {
        if (request.StructuredOutput is null || string.IsNullOrWhiteSpace(structuredJson))
        {
            return false;
        }

        try
        {
            using var _ = JsonDocument.Parse(structuredJson);
            return true;
        }
        catch (JsonException ex)
        {
            throw new LlmProviderException(new OperationError("structured_output_invalid", $"Structured output was not valid JSON: {ex.Message}", false));
        }
    }

    private static JsonDocument ParseProviderJson(string body, string code, string message)
    {
        try
        {
            return JsonDocument.Parse(body);
        }
        catch (JsonException ex)
        {
            throw new LlmProviderException(new OperationError(code, $"{message} {ex.Message}", false));
        }
    }

    private bool UsesOpenAiResponsesProtocol() =>
        string.Equals(_configuration.Protocol, "openai.responses", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeRole(string role) => role switch
    {
        "system" => "system",
        "developer" => "developer",
        "assistant" => "assistant",
        _ => "user"
    };

    private static string CreateSchemaName(SchemaRef schemaRef)
    {
        var value = schemaRef.Value.Replace("://", "_", StringComparison.Ordinal)
            .Replace("/", "_", StringComparison.Ordinal)
            .Replace("@", "_v", StringComparison.Ordinal)
            .Replace("-", "_", StringComparison.Ordinal);
        return value;
    }

    private static string BuildFilename(ArtifactInputBlock artifact)
    {
        var extension = artifact.MimeType switch
        {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => "bin"
        };

        return $"{artifact.ArtifactId.Value}.{extension}";
    }

    private static string BuildFilename(ArtifactSourceDescriptor artifact)
    {
        var extension = artifact.MimeType switch
        {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => "bin"
        };

        return string.IsNullOrWhiteSpace(artifact.Filename)
            ? $"{artifact.Artifact.ArtifactId.Value}.{extension}"
            : artifact.Filename;
    }

    private static (string ContentType, byte[] Bytes) ParseDataUrl(string dataUrl)
    {
        const string marker = ";base64,";
        if (!dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            throw new LlmProviderException(new OperationError("provider_file_upload_invalid_data_url", "Inline transport data must be a data URL.", false));
        }

        var markerIndex = dataUrl.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 5)
        {
            throw new LlmProviderException(new OperationError("provider_file_upload_invalid_data_url", "Inline transport data URL must use base64 encoding.", false));
        }

        var contentType = dataUrl[5..markerIndex];
        var base64 = dataUrl[(markerIndex + marker.Length)..];
        try
        {
            return (contentType, Convert.FromBase64String(base64));
        }
        catch (FormatException)
        {
            throw new LlmProviderException(new OperationError("provider_file_upload_invalid_data_url", "Inline transport data URL contained invalid base64 content.", false));
        }
    }

    private static string? ExtractOpenAiOutputText(JsonElement root)
    {
        if (!root.TryGetProperty("output", out var outputElement) || outputElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var fragments = new List<string>();
        foreach (var item in outputElement.EnumerateArray())
        {
            if (!item.TryGetProperty("content", out var contentElement) || contentElement.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var content in contentElement.EnumerateArray())
            {
                if (content.TryGetProperty("type", out var typeElement)
                    && string.Equals(typeElement.GetString(), "output_text", StringComparison.Ordinal)
                    && content.TryGetProperty("text", out var textElement)
                    && textElement.ValueKind == JsonValueKind.String)
                {
                    fragments.Add(textElement.GetString() ?? string.Empty);
                }
            }
        }

        return fragments.Count == 0 ? null : string.Concat(fragments);
    }

    private static string? ExtractOpenAiRefusal(JsonElement root)
    {
        if (!root.TryGetProperty("output", out var outputElement) || outputElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var item in outputElement.EnumerateArray())
        {
            if (!item.TryGetProperty("content", out var contentElement) || contentElement.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var content in contentElement.EnumerateArray())
            {
                if (!content.TryGetProperty("type", out var typeElement))
                {
                    continue;
                }

                if (string.Equals(typeElement.GetString(), "refusal", StringComparison.OrdinalIgnoreCase))
                {
                    if (content.TryGetProperty("refusal", out var refusalElement) && refusalElement.ValueKind == JsonValueKind.String)
                    {
                        return refusalElement.GetString();
                    }

                    if (content.TryGetProperty("text", out var textElement) && textElement.ValueKind == JsonValueKind.String)
                    {
                        return textElement.GetString();
                    }
                }
            }
        }

        return null;
    }

    private static OperationError CreateHttpError(HttpStatusCode statusCode, string body)
    {
        var retryable = statusCode == HttpStatusCode.TooManyRequests || (int)statusCode >= 500;
        var code = statusCode == HttpStatusCode.TooManyRequests ? "provider_rate_limited" : "provider_http_error";
        var sanitizedBody = body.Length > 500 ? body[..500] : body;
        return new OperationError(code, $"Provider HTTP error {(int)statusCode}: {sanitizedBody}", retryable);
    }
}