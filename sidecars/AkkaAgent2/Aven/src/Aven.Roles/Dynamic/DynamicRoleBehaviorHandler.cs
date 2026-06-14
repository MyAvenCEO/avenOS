using System.Text.Json;
using Aven.Roles.Dynamic.Models;
using Aven.Roles.Dynamic.Runtime;
using Aven.Roles.Dynamic.Schemas;

namespace Aven.Roles.Dynamic;

public sealed class DynamicRoleBehaviorHandler : IRoleBehaviorHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly RoleProfile _profile;
    private readonly string _objective;
    private readonly DynamicRoleOptions _options;
    private readonly IReadOnlyList<string> _allowedSkills;

    public DynamicRoleBehaviorHandler(RoleProfile profile, string objective, DynamicRoleOptions? options = null)
    {
        _profile = profile;
        _objective = objective;
        _options = options ?? new DynamicRoleOptions();
        _allowedSkills = ResolveAllowedSkills(profile.AllowedSkills);
    }

    public string? CreateInitialStateJson() => JsonSerializer.Serialize(DynamicRoleState.Empty, JsonOptions);

    public bool CanHandle(OperationResolved resolved, RoleBehaviorContext context)
    {
        return IsDynamicInputCommand(resolved.Key.OperationType)
            || string.Equals(resolved.Key.OperationType, ResourceOperationTypes.LlmStructuredGenerate, StringComparison.Ordinal)
            || string.Equals(resolved.Key.OperationType, ResourceOperationTypes.MetadataQuery, StringComparison.Ordinal)
            || string.Equals(resolved.Key.OperationType, ResourceOperationTypes.ShellExecute, StringComparison.Ordinal)
            || string.Equals(resolved.Key.OperationType, ResourceOperationTypes.HumanApprove, StringComparison.Ordinal);
    }

    public RoleBehaviorResult Apply(OperationResolved resolved, RoleBehaviorContext context)
    {
        var state = RoleBehaviorSupport.StateOrDefault(context.RoleStateJson, DynamicRoleState.Empty);

        if (IsDynamicInputCommand(resolved.Key.OperationType))
        {
            return ApplyInitialInput(resolved, context, state);
        }

        if (string.Equals(resolved.Key.OperationType, ResourceOperationTypes.LlmStructuredGenerate, StringComparison.Ordinal))
        {
            return ApplyPlannerDecision(resolved, context, state);
        }

        return ContinueAfterToolObservation(resolved, context, state);
    }

    public object CreateCommittedCommand(string expectedCommandType, RoleCommittedInput input) => new DynamicRoleInputCommand(
        _profile.RoleName,
        expectedCommandType,
        input.ProposedIntent ?? input.ContentSummary ?? $"Handle {input.ClaimId.Value}",
        input.ContentSummary,
        input.ProposedIntent,
        input.IncomingItemRef,
        input.AttachmentRefs,
        input.RequiredSchemas,
        input.CorrelationId.Value);

    private RoleBehaviorResult ApplyInitialInput(OperationResolved resolved, RoleBehaviorContext context, DynamicRoleState state)
    {
        var command = DeserializeInputCommand(resolved);
        var goal = command.Goal;
        var inputJson = resolved.Value.ValueJson;
        var updated = AddObservation(
            state with { CurrentGoalSummary = goal },
            new DynamicRoleObservation("input", goal, Truncate(inputJson, _options.MaxObservationChars), DateTimeOffset.UtcNow));
        return RequestNextPlannerStep(context, resolved.CorrelationId, updated, "initial_input");
    }

    private RoleBehaviorResult ContinueAfterToolObservation(OperationResolved resolved, RoleBehaviorContext context, DynamicRoleState state)
    {
        var summary = $"Tool '{resolved.Key.OperationType}' resolved.";
        var updated = AddObservation(
            state,
            new DynamicRoleObservation(resolved.Key.OperationType, summary, Truncate(resolved.Value.ValueJson, _options.MaxObservationChars), DateTimeOffset.UtcNow));
        return RequestNextPlannerStep(context, resolved.CorrelationId, updated, "tool_result");
    }

    private RoleBehaviorResult ApplyPlannerDecision(OperationResolved resolved, RoleBehaviorContext context, DynamicRoleState state)
    {
        var envelope = JsonSerializer.Deserialize<LlmStructuredRoleOperationResult>(resolved.Value.ValueJson, JsonOptions)
            ?? throw new InvalidOperationException("Dynamic role planner result was empty.");
        var decision = JsonSerializer.Deserialize<DynamicRoleStepDecision>(envelope.StructuredJson, JsonOptions)
            ?? throw new InvalidOperationException("Dynamic role planner decision was empty.");

        var updated = state with
        {
            LastPlannerSummary = decision.RationaleSummary
        };

        if (string.Equals(decision.Status, "complete", StringComparison.OrdinalIgnoreCase))
        {
            var answer = string.IsNullOrWhiteSpace(decision.FinalAnswer)
                ? decision.RationaleSummary ?? "Dynamic role completed."
                : decision.FinalAnswer!;
            return new RoleBehaviorResult(RoleBehaviorStatus.Idle, JsonSerializer.Serialize(updated, JsonOptions), Array.Empty<RoleOperation>(), answer);
        }

        if (string.Equals(decision.Status, "fail", StringComparison.OrdinalIgnoreCase))
        {
            var reason = string.IsNullOrWhiteSpace(decision.FailureReason)
                ? decision.RationaleSummary ?? "Dynamic role planner failed."
                : decision.FailureReason!;
            return new RoleBehaviorResult(RoleBehaviorStatus.Failed, JsonSerializer.Serialize(updated, JsonOptions), Array.Empty<RoleOperation>(), reason);
        }

        if (string.Equals(decision.Status, "await_input", StringComparison.OrdinalIgnoreCase))
        {
            var note = string.IsNullOrWhiteSpace(decision.FinalAnswer)
                ? decision.RationaleSummary ?? "Dynamic role is waiting for more input."
                : decision.FinalAnswer!;
            return new RoleBehaviorResult(RoleBehaviorStatus.Idle, JsonSerializer.Serialize(updated, JsonOptions), Array.Empty<RoleOperation>(), note);
        }

        if (string.Equals(decision.Status, "ask_human", StringComparison.OrdinalIgnoreCase))
        {
            var promptText = string.IsNullOrWhiteSpace(decision.HumanPrompt)
                ? decision.RationaleSummary ?? "Dynamic role needs human input."
                : decision.HumanPrompt!;
            var requestId = NextRequestId(context.RoleAgentId, updated.StepCount, ResourceKinds.Human);
            var payload = new HumanPromptOperationPayload(
                requestId,
                promptText,
                RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "dynamic-human"),
                DateTimeOffset.UtcNow.AddMinutes(30));
            return new RoleBehaviorResult(
                RoleBehaviorStatus.WaitingForHuman,
                JsonSerializer.Serialize(updated, JsonOptions),
                [RoleBehaviorSupport.HumanPrompt(requestId, resolved.CorrelationId, payload)],
                decision.RationaleSummary);
        }

        if (!string.Equals(decision.Status, "continue", StringComparison.OrdinalIgnoreCase))
        {
            return new RoleBehaviorResult(
                RoleBehaviorStatus.Failed,
                JsonSerializer.Serialize(updated, JsonOptions),
                Array.Empty<RoleOperation>(),
                $"Dynamic role planner returned unsupported status '{decision.Status}'.");
        }

        if (decision.Action is null || !string.Equals(decision.Action.Kind, "callSkill", StringComparison.OrdinalIgnoreCase))
        {
            return new RoleBehaviorResult(
                RoleBehaviorStatus.Failed,
                JsonSerializer.Serialize(updated, JsonOptions),
                Array.Empty<RoleOperation>(),
                "Dynamic role planner requested continue without a callSkill action.");
        }

        var operation = CreateSkillOperation(decision.Action, context, resolved.CorrelationId, updated.StepCount);
        return new RoleBehaviorResult(RoleBehaviorStatus.WaitingForOperation, JsonSerializer.Serialize(updated, JsonOptions), [operation], decision.RationaleSummary);
    }

    private RoleBehaviorResult RequestNextPlannerStep(RoleBehaviorContext context, CorrelationId correlationId, DynamicRoleState state, string reason)
    {
        if (state.StepCount >= _options.MaxStepsPerRun)
        {
            return new RoleBehaviorResult(
                RoleBehaviorStatus.Blocked,
                JsonSerializer.Serialize(state, JsonOptions),
                Array.Empty<RoleOperation>(),
                $"Dynamic role reached the configured step limit of {_options.MaxStepsPerRun}.");
        }

        var next = state with { StepCount = state.StepCount + 1 };
        var requestId = NextRequestId(context.RoleAgentId, next.StepCount, "plan");
        var payload = new LlmStructuredGenerateOperationPayload(
            requestId,
            BuildPlannerInput(next, reason),
            DynamicRoleSchemaRefs.StepDecisionV1,
            "dynamic_role_next_step",
            Model: null,
            MaxOutputTokens: 2048,
            MaxInputTokens: 16000,
            MaxCost: null,
            EnableReasoningSummary: false,
            ThinkingBudget: null,
            CapabilityId: RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "dynamic-llm"));

        return new RoleBehaviorResult(
            RoleBehaviorStatus.WaitingForOperation,
            JsonSerializer.Serialize(next, JsonOptions),
            [RoleBehaviorSupport.LlmStructuredGeneration(requestId, correlationId, payload)],
            null);
    }

    private IReadOnlyList<LlmStructuredInputBlock> BuildPlannerInput(DynamicRoleState state, string reason)
    {
        var skillDescriptions = _allowedSkills
            .Select(skillId => SkillCatalog.TryGet(skillId, out var skill) && skill is not null
                ? $"- {skill.SkillId}: {skill.Description}"
                : $"- {skillId}: custom skill")
            .ToArray();

        var systemPrompt = string.IsNullOrWhiteSpace(_profile.SystemPrompt)
            ? $"You are {_profile.DisplayName}. {_profile.ResponsibilityScope}"
            : _profile.SystemPrompt!;

        var instructions = $"""
        {systemPrompt}

        Objective:
        {_objective}

        You are a soft dynamic Aven role. Choose exactly one next action and return JSON matching schema://dynamic-role/step-decision@1.
        Use tools only from the allowed skill list. Do not claim durable state changed unless a gateway-backed tool result says it did.
        Shell execution is a prototype escape hatch; prefer metadata.query or human.review when either is enough.

        Allowed skills:
        {string.Join('\n', skillDescriptions)}
        """;

        var stateJson = JsonSerializer.Serialize(new
        {
            reason,
            state.CurrentGoalSummary,
            state.StepCount,
            state.LastPlannerSummary,
            observations = state.RecentObservations
        }, JsonOptions);

        return
        [
            new LlmStructuredInputBlock("text", Text: instructions, Role: "developer"),
            new LlmStructuredInputBlock("json", Json: stateJson, Role: "user")
        ];
    }

    private RoleOperation CreateSkillOperation(DynamicRoleAction action, RoleBehaviorContext context, CorrelationId correlationId, int step)
    {
        if (!_allowedSkills.Contains(action.SkillId, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Dynamic role is not allowed to use skill '{action.SkillId}'.");
        }

        if (string.Equals(action.SkillId, SkillCatalog.MetadataQuery, StringComparison.OrdinalIgnoreCase))
        {
            var requestId = ExtractString(action.Input, "requestId") ?? NextRequestId(context.RoleAgentId, step, "metadata-query");
            var payload = new MetadataQueryOperationPayload(
                requestId,
                ExtractStringArray(action.Input, "subjectKinds"),
                ExtractStringArray(action.Input, "subjectIds"),
                ExtractStringArray(action.Input, "schemaRefs")?.Select(static value => new SchemaRef(value)).ToArray(),
                Math.Min(ExtractInt(action.Input, "limit") ?? 100, _options.MaxMetadataQueryLimit),
                ExtractInt(action.Input, "timeoutMilliseconds") ?? 1000,
                RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "dynamic-metadata-query"));
            return RoleBehaviorSupport.MetadataQuery(requestId, correlationId, payload);
        }

        if (string.Equals(action.SkillId, SkillCatalog.ShellExecute, StringComparison.OrdinalIgnoreCase))
        {
            var command = ExtractString(action.Input, "command");
            if (string.IsNullOrWhiteSpace(command))
            {
                throw new InvalidOperationException("shell.execute requires a non-empty 'command' input.");
            }

            var requestId = ExtractString(action.Input, "requestId") ?? NextRequestId(context.RoleAgentId, step, ResourceKinds.Shell);
            var payload = new ShellExecuteOperationPayload(
                requestId,
                command!,
                ExtractString(action.Input, "workingDirectory"),
                null,
                ExtractString(action.Input, "stdin"),
                Math.Min(ExtractInt(action.Input, "timeoutSeconds") ?? _options.DefaultShellTimeoutSeconds, _options.DefaultShellTimeoutSeconds),
                Math.Min(ExtractInt(action.Input, "maxOutputBytes") ?? _options.DefaultShellMaxOutputBytes, _options.DefaultShellMaxOutputBytes),
                RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "dynamic-shell"));
            return RoleBehaviorSupport.ShellExecute(requestId, correlationId, payload);
        }

        if (string.Equals(action.SkillId, SkillCatalog.HumanReview, StringComparison.OrdinalIgnoreCase))
        {
            var prompt = ExtractString(action.Input, "prompt") ?? ExtractString(action.Input, "promptText");
            if (string.IsNullOrWhiteSpace(prompt))
            {
                throw new InvalidOperationException("human.review requires a 'prompt' input.");
            }

            var requestId = ExtractString(action.Input, "requestId") ?? NextRequestId(context.RoleAgentId, step, ResourceKinds.Human);
            var payload = new HumanPromptOperationPayload(
                requestId,
                prompt!,
                RoleCapabilityIds.ForRoleAgent(context.RoleAgentId, "dynamic-human"),
                DateTimeOffset.UtcNow.AddMinutes(30));
            return RoleBehaviorSupport.HumanPrompt(requestId, correlationId, payload);
        }

        throw new InvalidOperationException($"Dynamic role skill '{action.SkillId}' is not mapped to a resource operation.");
    }

    private DynamicRoleInputCommand DeserializeInputCommand(OperationResolved resolved)
    {
        try
        {
            var command = JsonSerializer.Deserialize<DynamicRoleInputCommand>(resolved.Value.ValueJson, JsonOptions);
            if (command is not null)
            {
                return command;
            }
        }
        catch
        {
            // Fall through to the generic payload shape used by older dynamic committed-input fallback commands.
        }

        return new DynamicRoleInputCommand(
            _profile.RoleName,
            resolved.Key.OperationType,
            _objective,
            null,
            null,
            null,
            Array.Empty<string>(),
            Array.Empty<SchemaRef>(),
            resolved.CorrelationId.Value);
    }

    private bool IsDynamicInputCommand(string operationType) =>
        string.Equals(operationType, $"{_profile.RoleName}.ingest_document", StringComparison.Ordinal)
        || string.Equals(operationType, "dynamic.ingest_document", StringComparison.Ordinal);

    private DynamicRoleState AddObservation(DynamicRoleState state, DynamicRoleObservation observation)
    {
        var observations = (state.RecentObservations ?? Array.Empty<DynamicRoleObservation>())
            .Concat([observation])
            .TakeLast(_options.MaxRecentObservations)
            .ToArray();
        return state with { RecentObservations = observations };
    }

    private static IReadOnlyList<string> ResolveAllowedSkills(IReadOnlyList<string>? configured)
    {
        var skills = configured is { Count: > 0 }
            ? configured
            : SkillCatalog.DefaultDynamicSkillIds;
        return skills.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static string NextRequestId(RoleAgentId roleAgentId, int step, string kind) =>
        $"dynamic-{Sanitize(roleAgentId.Value)}-{kind}-{step}";

    private static string Sanitize(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var index = 0;
        foreach (var ch in value)
        {
            buffer[index++] = char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-';
        }

        return new string(buffer[..index]);
    }

    private static string Truncate(string value, int maxChars) =>
        value.Length <= maxChars ? value : value[..maxChars] + "…";

    private static string? ExtractString(JsonElement? input, string propertyName)
    {
        if (input is null || input.Value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return input.Value.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static int? ExtractInt(JsonElement? input, string propertyName)
    {
        if (input is null || input.Value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (!input.Value.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var value)
            ? value
            : null;
    }

    private static IReadOnlyList<string>? ExtractStringArray(JsonElement? input, string propertyName)
    {
        if (input is null || input.Value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (!input.Value.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var values = property
            .EnumerateArray()
            .Where(static element => element.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(element.GetString()))
            .Select(static element => element.GetString()!)
            .ToArray();
        return values.Length == 0 ? null : values;
    }

    private sealed record LlmStructuredRoleOperationResult(string StructuredJson, string? TransportSummary = null);
}
