using System.Text.Json;
using Akka.Actor;
using Aven.Contracts.Protocol;
using Aven.Resources.Llm.Contracts.Commands;
using Aven.Resources.Llm.Contracts.Responses;

namespace Aven.Routing.Engines;

public sealed class LlmRoleSelector
{
    private static readonly ActorAddress RoutingCaller = new("api/routing", "local");
    private static readonly CapabilityId RoutingCapabilityId = new("api-routing-llm-cap");
    private readonly IActorRef _llmGatewayActor;
    private readonly LlmRoleSelectorOptions _options;

    public LlmRoleSelector(IActorRef llmGatewayActor, LlmRoleSelectorOptions options)
    {
        _llmGatewayActor = llmGatewayActor;
        _options = options;
    }

    public async Task<LlmRoutingEvaluation> EvaluateAsync(RouteInput input, IReadOnlyList<RoleAgentProfile> profiles)
    {
        var attempts = new List<RouteSelectionAttemptTrace>();
        var promptSummary = BuildPromptSummary(input, profiles);

        for (var attempt = 1; attempt <= Math.Max(1, _options.MaxRepairAttempts); attempt++)
        {
            var command = BuildCommand(input, profiles, promptSummary, attempt, attempt > 1);
            try
            {
                var reply = await _llmGatewayActor
                    .Ask<LlmStructuredGenerationReply>(command, TimeSpan.FromSeconds(60))
                    .ConfigureAwait(false);

                switch (reply)
                {
                    case LlmStructuredGenerationSucceeded succeeded:
                    {
                        var parsed = ParseDecision(succeeded.StructuredJson);
                        attempts.Add(new RouteSelectionAttemptTrace(
                            attempt,
                            promptSummary,
                            succeeded.StructuredJson,
                            true,
                            parsed.Decision,
                            parsed.CandidateRoleAgentIds,
                            parsed.ClarificationQuestion,
                            null,
                            null));

                        return new LlmRoutingEvaluation(
                            parsed,
                            new RouteSelectionTrace(succeeded.Response.Provider, succeeded.Response.Model, true, false, attempts),
                            false);
                    }
                    case LlmStructuredGenerationRejected rejected when IsProviderUnavailable(rejected.Error) && _options.AllowDeterministicFallbackWhenProviderUnavailable:
                        return CreateDeterministicFallback(attempts);
                    case LlmStructuredGenerationFailed failed when IsProviderUnavailable(failed.Error) && _options.AllowDeterministicFallbackWhenProviderUnavailable:
                        return CreateDeterministicFallback(attempts);
                    case LlmStructuredGenerationRejected rejected when IsRepairable(rejected.Error):
                        attempts.Add(CreateFailedAttemptTrace(attempt, promptSummary, rejected.Error));
                        continue;
                    case LlmStructuredGenerationFailed failed when IsRepairable(failed.Error):
                        attempts.Add(CreateFailedAttemptTrace(attempt, promptSummary, failed.Error));
                        continue;
                    case LlmStructuredGenerationRejected rejected:
                        attempts.Add(CreateFailedAttemptTrace(attempt, promptSummary, rejected.Error));
                        return CreateRepeatedMalformedResult(attempts);
                    case LlmStructuredGenerationFailed failed:
                        attempts.Add(CreateFailedAttemptTrace(attempt, promptSummary, failed.Error));
                        return CreateRepeatedMalformedResult(attempts);
                    default:
                        attempts.Add(new RouteSelectionAttemptTrace(
                            attempt,
                            promptSummary,
                            null,
                            false,
                            null,
                            Array.Empty<RoleAgentId>(),
                            null,
                            "routing_llm_failed",
                            $"Unexpected gateway reply: {reply.GetType().Name}"));
                        return CreateRepeatedMalformedResult(attempts);
                }
            }
            catch (Exception ex) when (attempt < Math.Max(1, _options.MaxRepairAttempts))
            {
                attempts.Add(new RouteSelectionAttemptTrace(
                    attempt,
                    promptSummary,
                    null,
                    false,
                    null,
                    Array.Empty<RoleAgentId>(),
                    null,
                    "routing_llm_failed",
                    ex.Message));
            }
            catch (Exception ex)
            {
                attempts.Add(new RouteSelectionAttemptTrace(
                    attempt,
                    promptSummary,
                    null,
                    false,
                    null,
                    Array.Empty<RoleAgentId>(),
                    null,
                    "routing_llm_failed",
                    ex.Message));
                break;
            }
        }

        return CreateRepeatedMalformedResult(attempts);
    }

    private LlmStructuredGenerationCommand BuildCommand(
        RouteInput input,
        IReadOnlyList<RoleAgentProfile> profiles,
        string promptSummary,
        int attempt,
        bool isRepairAttempt)
    {
        var contextJson = JsonSerializer.Serialize(new
        {
            input = new
            {
                input.RoutingAttemptId,
                input.IncomingItemRef,
                input.InputType,
                input.AttachmentRefs,
                input.ContentSummary,
                input.ProposedIntent,
                input.ProposedReason,
                requiredSchemas = input.RequiredSchemas.Select(static x => x.Value).ToArray()
            },
            candidates = profiles.Select(profile => new
            {
                roleAgentId = profile.RoleAgentId.Value,
                profile.RoleName,
                profile.DisplayName,
                profile.ResponsibilityScope,
                profile.AcceptedInputTypes,
                primarySchemas = profile.PrimarySchemas.Select(static x => x.Value).ToArray(),
                profile.RoutingDescription,
                profile.ExamplesOfRelevantInput,
                profile.ExamplesOfIrrelevantInput,
                profile.RecentSummary
            }).ToArray(),
            instructions = isRepairAttempt
                ? "Return valid JSON for the routing schema only. Do not add prose, markdown, or extra fields."
                : "Rank the best role-agent candidates for this input. Ask for clarification when the input is ambiguous."
        });

        return new LlmStructuredGenerationCommand(
            new RequestId($"{input.RoutingAttemptId.Value}/llm/{attempt}"),
            RoutingCaller,
            input.CorrelationId,
            _options.Model,
            new LlmInputBlock[]
            {
                new TextInputBlock(promptSummary, "system"),
                new JsonInputBlock(contextJson)
            },
            RoutingSchemaRefs.DecisionV1,
            "routing_decision",
            new LlmReasoningOptions(EnableReasoningSummary: true, ThinkingBudget: "small"),
            new LlmBudgetLimits(MaxCost: 1m, MaxInputTokens: 4000, MaxOutputTokens: 500),
            new LlmSafetySettings(),
            RoutingCapabilityId);
    }

    private static ParsedRouteResolution ParseDecision(string? structuredJson)
    {
        if (string.IsNullOrWhiteSpace(structuredJson))
        {
            throw new InvalidOperationException("Routing provider returned no structured JSON.");
        }

        using var document = JsonDocument.Parse(structuredJson);
        var root = document.RootElement;
        var decision = root.GetProperty("decision").GetString() ?? "clarify";
        var reason = root.GetProperty("reason").GetString() ?? string.Empty;
        var clarificationQuestion = root.TryGetProperty("clarificationQuestion", out var questionElement) && questionElement.ValueKind == JsonValueKind.String
            ? questionElement.GetString()
            : null;
        var candidateRoleAgentIds = root.GetProperty("candidateRoleAgentIds")
            .EnumerateArray()
            .Where(static x => x.ValueKind == JsonValueKind.String)
            .Select(x => new RoleAgentId(x.GetString() ?? string.Empty))
            .Where(static x => !string.IsNullOrWhiteSpace(x.Value))
            .ToArray();

        return new ParsedRouteResolution(decision, candidateRoleAgentIds, reason, clarificationQuestion);
    }

    private static RouteSelectionAttemptTrace CreateFailedAttemptTrace(int attempt, string promptSummary, OperationError error) =>
        new(
            attempt,
            promptSummary,
            null,
            false,
            null,
            Array.Empty<RoleAgentId>(),
            null,
            error.Code,
            error.Message);

    private LlmRoutingEvaluation CreateDeterministicFallback(IReadOnlyList<RouteSelectionAttemptTrace> attempts) =>
        new(
            null,
            new RouteSelectionTrace("gateway", _options.Model.ModelName, false, _options.AllowDeterministicFallbackWhenProviderUnavailable, attempts),
            true);

    private LlmRoutingEvaluation CreateRepeatedMalformedResult(IReadOnlyList<RouteSelectionAttemptTrace> attempts) =>
        new(
            new ParsedRouteResolution(
                "clarify",
                Array.Empty<RoleAgentId>(),
                "The routing model returned malformed output repeatedly.",
                "I could not safely determine the correct role from the routing model output. Which agent should handle this input?"),
            new RouteSelectionTrace("gateway", _options.Model.ModelName, true, false, attempts),
            false);

    private static bool IsRepairable(OperationError error) =>
        string.Equals(error.Code, "structured_output_invalid", StringComparison.Ordinal)
        || string.Equals(error.Code, "schema_validation_failed", StringComparison.Ordinal)
        || string.Equals(error.Code, "routing_llm_failed", StringComparison.Ordinal)
        || string.Equals(error.Code, "llm_structured_generation_failed", StringComparison.Ordinal);

    private static bool IsProviderUnavailable(OperationError error) =>
        string.Equals(error.Code, "blocked_missing_provider", StringComparison.Ordinal);

    private static string BuildPromptSummary(RouteInput input, IReadOnlyList<RoleAgentProfile> profiles)
        => $"Route input '{input.RoutingAttemptId.Value}' with type '{input.InputType}' and summary '{input.ContentSummary}' across {profiles.Count} role agents. Prefer the best candidate order, but ask for clarification instead of guessing when the evidence is ambiguous.";
}
