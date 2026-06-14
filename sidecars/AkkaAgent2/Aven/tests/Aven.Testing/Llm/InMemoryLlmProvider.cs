namespace Aven.Resources.Llm;

public sealed class InMemoryLlmProvider : ILlmProvider, ILlmExecutionStrategyProvider
{
    private static readonly Dictionary<string, InMemoryLlmResponsePlan> ConfiguredPlans = new(StringComparer.Ordinal);
    private static readonly object ConfiguredPlansGate = new();
    private readonly SimpleStructuredJsonValidator _validator = new();

    public string Name => "in-memory";

    public static void Configure(string requestId, InMemoryLlmResponsePlan plan)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(requestId);
        ArgumentNullException.ThrowIfNull(plan);

        lock (ConfiguredPlansGate)
        {
            ConfiguredPlans[requestId] = plan;
        }
    }

    public static bool TryGetPlan(OperationKey key, out InMemoryLlmResponsePlan? plan)
    {
        lock (ConfiguredPlansGate)
        {
            return ConfiguredPlans.TryGetValue(key.RequestId.Value, out plan);
        }
    }

    public LlmProviderHealth GetHealth() => new(Name, true, true, "ok", "Deterministic in-memory provider is available.", "in-memory-model");

    public LlmExecutionStrategy DescribeExecutionStrategy(LlmRequest request)
    {
        if (TryGetPlan(request.Key, out var configuredPlan)
            && configuredPlan is { Scenario: InMemoryLlmScenarioKind.InFlightUnknown })
        {
            return new LlmExecutionStrategy(
                StartExternalCallWithoutImmediateProviderExecution: true,
                RecoverableAfterRestart: configuredPlan.RecoverableAfterRestart,
                InFlightReplyError: new OperationError(
                    "in_flight_started",
                    "External call started and remains in-flight for recovery testing.",
                    true));
        }

        return LlmExecutionStrategy.Immediate;
    }

    public Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryGetPlan(request.Key, out var configuredPlan) || configuredPlan is null)
        {
            throw new InvalidOperationException($"No in-memory LLM plan configured for request '{request.Key.RequestId.Value}'.");
        }

        var degradations = new List<LlmProviderDegradation>();
        var usage = new LlmUsage(
            configuredPlan.PromptTokens,
            configuredPlan.CompletionTokens,
            configuredPlan.PromptTokens + configuredPlan.CompletionTokens,
            configuredPlan.Cost);

        var response = configuredPlan.Scenario switch
        {
            InMemoryLlmScenarioKind.TextSuccess => new LlmResponse(
                Name,
                request.Model.ModelName,
                configuredPlan.Text ?? "deterministic in-memory text response",
                null,
                Array.Empty<LlmToolCall>(),
                null,
                null,
                request.Reasoning.EnableReasoningSummary ? "deterministic reasoning summary" : null,
                Array.Empty<string>(),
                usage,
                "stop",
                degradations,
                null,
                false),

            InMemoryLlmScenarioKind.Refusal => new LlmResponse(
                Name,
                request.Model.ModelName,
                null,
                null,
                Array.Empty<LlmToolCall>(),
                configuredPlan.Text ?? "refused by deterministic in-memory provider",
                null,
                null,
                Array.Empty<string>(),
                usage,
                "refusal",
                degradations,
                null,
                false),

            InMemoryLlmScenarioKind.SafetyBlock => new LlmResponse(
                Name,
                request.Model.ModelName,
                null,
                null,
                Array.Empty<LlmToolCall>(),
                null,
                configuredPlan.Text ?? "blocked by deterministic in-memory safety policy",
                null,
                Array.Empty<string>(),
                usage,
                "safety_block",
                degradations,
                null,
                false),

            InMemoryLlmScenarioKind.StructuredSuccess => BuildStructuredResponse(request, usage, degradations),
            InMemoryLlmScenarioKind.InFlightUnknown => throw new InvalidOperationException("In-flight scenarios should not be synchronously executed."),
            _ => throw new ArgumentOutOfRangeException()
        };

        return Task.FromResult(response);
    }

    private LlmResponse BuildStructuredResponse(LlmRequest request, LlmUsage usage, List<LlmProviderDegradation> degradations)
    {
        if (!TryGetPlan(request.Key, out var configuredPlan) || configuredPlan is null)
        {
            throw new InvalidOperationException($"No in-memory LLM plan configured for request '{request.Key.RequestId.Value}'.");
        }

        var contract = request.StructuredOutput ?? throw new InvalidOperationException("Structured success requires a structured output contract.");
        var structuredJson = configuredPlan.StructuredJson ?? "{}";

        if (!request.Model.SupportsStrictStructuredOutput)
        {
            degradations.Add(new LlmProviderDegradation(
                "prompt_only_structured_output",
                "Provider cannot enforce strict structured output; using prompt-only fallback."));
        }

        var errors = _validator.Validate(contract.JsonSchema, structuredJson);
        if (errors.Count > 0)
        {
            throw new InvalidOperationException(string.Join("; ", errors));
        }

        return new LlmResponse(
            Name,
            request.Model.ModelName,
            null,
            structuredJson,
            Array.Empty<LlmToolCall>(),
            null,
            null,
            request.Reasoning.EnableReasoningSummary ? "deterministic reasoning summary" : null,
            Array.Empty<string>(),
            usage,
            request.Model.SupportsStrictStructuredOutput ? "structured_stop" : "prompt_fallback",
            degradations,
            contract.SchemaRef,
            true);
    }
}