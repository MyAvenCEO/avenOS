using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Aven.Api.Requests;
using Aven.Api.Runtime;
using Aven.Sidecar.Protocol;
using Aven.Submission.Contracts.Responses;

namespace Aven.Sidecar;

/// <summary>
/// Maps frozen RPC methods to <see cref="RuntimeCompositionRoot"/> calls and normalizes
/// the results into protocol result/error envelopes (milestone plan M2 steps 3-4).
///
/// Every data method goes through the same actor-backed runtime path the HTTP host uses;
/// the sidecar adds no lower-level shortcuts that would bypass durable delivery, routing,
/// work intake, role-agent actors, resource gateways, inboxes, ledgers, or trace (D15).
/// </summary>
public sealed class MethodDispatcher
{
    /// <summary>Domain serialization mirrors Aven.Api: web defaults + string enums.</summary>
    private static readonly JsonSerializerOptions DomainJson = CreateDomainJson();

    private readonly RuntimeCompositionRoot? _runtime;
    private readonly string? _startupError;
    private readonly SidecarLogger _logger;
    private readonly RuntimeEventCorrelation _correlation;

    public MethodDispatcher(
        RuntimeCompositionRoot? runtime,
        string? startupError,
        SidecarLogger logger,
        RuntimeEventCorrelation? correlation = null)
    {
        _runtime = runtime;
        _startupError = startupError;
        _logger = logger;
        _correlation = correlation ?? new RuntimeEventCorrelation();
    }

    /// <summary>Raised when <c>session.shutdown</c> is handled. The host drains and exits.</summary>
    public event Action? ShutdownRequested;

    public async Task<ProtocolEnvelope> DispatchAsync(ProtocolEnvelope request)
    {
        var id = request.Id ?? string.Empty;
        var method = request.Method ?? string.Empty;
        try
        {
            var result = await HandleAsync(method, request.Params).ConfigureAwait(false);
            return ProtocolEnvelope.ResponseResult(id, result);
        }
        catch (SidecarError error)
        {
            return ProtocolEnvelope.ResponseError(id, error.ToProtocolError());
        }
        catch (Exception ex)
        {
            _logger.Error($"unhandled exception dispatching '{method}'", ex);
            return ProtocolEnvelope.ResponseError(id, new ProtocolError(
                ProtocolErrorCodes.InternalError,
                $"Internal error handling '{method}': {ex.Message}"));
        }
    }

    private Task<JsonNode?> HandleAsync(string method, JsonNode? @params) => method switch
    {
        ProtocolMethods.SessionHello => Done(Hello()),
        ProtocolMethods.SessionPing => Done(new JsonObject { ["ok"] = true }),
        ProtocolMethods.SessionShutdown => Done(Shutdown()),
        ProtocolMethods.SkillsList => Done(new JsonObject { ["skills"] = ToNode(Runtime.ListSkills()) }),
        ProtocolMethods.RolesList => Done(new JsonObject { ["roles"] = ToNode(Runtime.ListRoleDefinitions()) }),
        ProtocolMethods.AgentsList => Done(new JsonObject { ["agents"] = ToNode(Runtime.ListAgents()) }),
        ProtocolMethods.AgentsCreate => Done(AgentsCreate(@params)),
        ProtocolMethods.AgentsGet => Done(AgentsGet(@params)),
        ProtocolMethods.MessagesSubmit => Done(MessagesSubmit(@params)),
        ProtocolMethods.MessagesResult => Done(MessagesResult(@params)),
        ProtocolMethods.HumanPromptsList => Done(new JsonObject { ["prompts"] = ToNode(Runtime.ListHumanPrompts()) }),
        ProtocolMethods.HumanPromptsGet => Done(HumanPromptsGet(@params)),
        ProtocolMethods.HumanPromptsAnswer => Done(HumanPromptsAnswer(@params)),
        ProtocolMethods.HumanPromptsCancel => Done(HumanPromptsCancel(@params)),
        _ => throw SidecarError.UnknownMethod(method),
    };

    private static Task<JsonNode?> Done(JsonNode? node) => Task.FromResult(node);

    // ---- lifecycle ---------------------------------------------------------

    private static JsonNode Hello() => new JsonObject
    {
        ["server"] = new JsonObject
        {
            ["name"] = SidecarInfo.ServerName,
            ["version"] = SidecarInfo.ServerVersion,
        },
        ["protocolVersion"] = ProtocolConstants.Version,
        ["capabilities"] = new JsonObject
        {
            // First slice: final-message first (D10), token streaming and tool events land in M8.
            ["streamingTokens"] = false,
            ["messages"] = true,
            ["humanPrompts"] = true,
            ["artifacts"] = false,
            ["debug"] = false,
        },
    };

    private JsonNode Shutdown()
    {
        ShutdownRequested?.Invoke();
        return new JsonObject { ["ok"] = true };
    }

    // ---- agents ------------------------------------------------------------

    private JsonNode? AgentsCreate(JsonNode? @params)
    {
        var o = RequireObject(@params);
        var request = new CreateAgentRequest(
            RoleAgentId: ReqStr(o, "roleAgentId"),
            RoleName: ReqStr(o, "roleName"),
            DisplayName: ReqStr(o, "displayName"),
            Objective: ReqStr(o, "objective"),
            ResponsibilityScope: ReqStr(o, "responsibilityScope"),
            AcceptedInputTypes: StrArray(o, "acceptedInputTypes"),
            PrimarySchemas: StrArray(o, "primarySchemas"),
            RoutingDescription: Str(o, "routingDescription"),
            ExamplesOfRelevantInput: StrArray(o, "examplesOfRelevantInput"),
            ExamplesOfIrrelevantInput: StrArray(o, "examplesOfIrrelevantInput"),
            RecentSummary: Str(o, "recentSummary"),
            SchedulePolicy: Str(o, "schedulePolicy"),
            Status: Str(o, "status"),
            ExecutionMode: Str(o, "executionMode"),
            Hardness: Str(o, "hardness"),
            SystemPrompt: Str(o, "systemPrompt"),
            AllowedSkills: StrArray(o, "allowedSkills"));

        return ToNode(Runtime.RegisterAgent(request));
    }

    private JsonNode? AgentsGet(JsonNode? @params)
    {
        var agentId = ReqStr(RequireObject(@params), "agentId");
        var view = Runtime.InspectAgent(agentId);
        if (view is null)
        {
            throw new SidecarError(ProtocolErrorCodes.AgentNotFound, $"Agent '{agentId}' was not found.");
        }

        return ToNode(view);
    }

    // ---- messages ----------------------------------------------------------

    private JsonNode? MessagesSubmit(JsonNode? @params)
    {
        var o = RequireObject(@params);
        var request = SubmitInputMapper.ToApiMessageRequest(o);
        var replyId = Str(o, "replyId");

        // Register BEFORE submitting: the run can start synchronously inside SubmitMessage and emit
        // RunStarted, so the correlation must exist first. The runtime correlation id is
        // deterministically "corr-{idempotencyKey}" (see MessageSubmissionActor); registering it
        // up front guarantees the very first run event is correlated to the app reply id (M8).
        var expectedCorrelationId = $"corr-{request.IdempotencyKey}";
        if (!string.IsNullOrWhiteSpace(replyId))
        {
            _correlation.Register(
                expectedCorrelationId,
                new ReplyCorrelation(replyId!, Str(o, "messageId") ?? string.Empty, Str(o, "identityId") ?? string.Empty));
        }

        var response = Runtime.SubmitMessage(request);

        if (response is SubmitMessageAccepted accepted)
        {
            // Reconcile in the unlikely event the actual correlation id differs.
            if (!string.IsNullOrWhiteSpace(replyId) && accepted.CorrelationId.Value != expectedCorrelationId)
            {
                _correlation.Register(
                    accepted.CorrelationId.Value,
                    new ReplyCorrelation(replyId!, Str(o, "messageId") ?? string.Empty, Str(o, "identityId") ?? string.Empty));
            }
        }
        else if (!string.IsNullOrWhiteSpace(replyId))
        {
            // Not accepted → no run will follow; don't leak the pre-registered correlation.
            _correlation.Forget(expectedCorrelationId);
        }

        return SubmitResultMapper.ToResultNode(response, DomainJson);
    }

    /// <summary>
    /// Settlement view for a routed agent's turn: whether the run has settled and the
    /// human-readable summary (LastRunSummary). Bounded polling target until M8 events
    /// (milestone plan M6 step 4; mirrors the E2E "wait for agent settled" pattern).
    /// </summary>
    private JsonNode? MessagesResult(JsonNode? @params)
    {
        var agentId = ReqStr(RequireObject(@params), "agentId");
        var view = Runtime.InspectAgent(agentId);
        if (view is null)
        {
            throw new SidecarError(ProtocolErrorCodes.AgentNotFound, $"Agent '{agentId}' was not found.");
        }

        var settled = string.Equals(view.Status, "Idle", StringComparison.OrdinalIgnoreCase)
            && view.ActiveRuns.Count == 0
            && view.PendingOperations.Count == 0
            && view.OpenWorkItems.Count == 0;

        return new JsonObject
        {
            ["agentId"] = view.RoleAgentId,
            ["status"] = view.Status,
            ["settled"] = settled,
            ["summary"] = view.LastRunSummary,
            ["activeRuns"] = view.ActiveRuns.Count,
            ["pendingOperations"] = view.PendingOperations.Count,
            ["openWorkItems"] = view.OpenWorkItems.Count,
        };
    }

    // ---- human prompts -----------------------------------------------------

    private JsonNode? HumanPromptsGet(JsonNode? @params)
    {
        var promptId = ReqStr(RequireObject(@params), "promptId");
        var view = Runtime.GetHumanPrompt(promptId);
        if (view is null)
        {
            throw new SidecarError(ProtocolErrorCodes.HumanPromptNotFound, $"Human prompt '{promptId}' was not found.");
        }

        return ToNode(view);
    }

    private JsonNode? HumanPromptsAnswer(JsonNode? @params)
    {
        var o = RequireObject(@params);
        var promptId = ReqStr(o, "promptId");
        var answer = ReqStr(o, "answer");
        var reply = Runtime.AnswerHumanPrompt(promptId, answer);
        if (reply is null)
        {
            throw new SidecarError(ProtocolErrorCodes.HumanPromptNotFound, $"Human prompt '{promptId}' was not found.");
        }

        return HumanPromptResultMapper.ToResultNode(reply, DomainJson);
    }

    private JsonNode? HumanPromptsCancel(JsonNode? @params)
    {
        var o = RequireObject(@params);
        var promptId = ReqStr(o, "promptId");
        var reason = Str(o, "reason");
        var reply = Runtime.CancelHumanPrompt(promptId, reason);
        if (reply is null)
        {
            throw new SidecarError(ProtocolErrorCodes.HumanPromptNotFound, $"Human prompt '{promptId}' was not found.");
        }

        return HumanPromptResultMapper.ToResultNode(reply, DomainJson);
    }

    // ---- helpers -----------------------------------------------------------

    private RuntimeCompositionRoot Runtime =>
        _runtime ?? throw SidecarError.RuntimeNotReady(_startupError ?? "Runtime failed to start.");

    private static JsonNode? ToNode(object? value) => JsonSerializer.SerializeToNode(value, DomainJson);

    private static JsonObject RequireObject(JsonNode? @params)
    {
        if (@params is JsonObject o)
        {
            return o;
        }

        throw SidecarError.InvalidParams("Request 'params' must be a JSON object.");
    }

    private static string? Str(JsonObject o, string key) =>
        o.TryGetPropertyValue(key, out var node) && node is not null ? node.GetValue<string?>() : null;

    private static string ReqStr(JsonObject o, string key)
    {
        var value = Str(o, key);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw SidecarError.InvalidParams($"Missing required parameter '{key}'.");
        }

        return value;
    }

    private static IReadOnlyList<string>? StrArray(JsonObject o, string key)
    {
        if (!o.TryGetPropertyValue(key, out var node) || node is not JsonArray array)
        {
            return null;
        }

        var list = new List<string>(array.Count);
        foreach (var item in array)
        {
            if (item is not null)
            {
                var s = item.GetValue<string?>();
                if (!string.IsNullOrWhiteSpace(s))
                {
                    list.Add(s);
                }
            }
        }

        return list;
    }

    private static JsonSerializerOptions CreateDomainJson()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}

/// <summary>Server identity reported by <c>session.hello</c>.</summary>
public static class SidecarInfo
{
    public const string ServerName = "akkaagent2-sidecar";
    public const string ServerVersion = "0.1.0";
}
