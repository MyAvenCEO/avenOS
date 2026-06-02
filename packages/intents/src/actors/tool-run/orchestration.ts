import type { ActorContext, JsonValue } from "typed-actors";
import type { IntentNextAction } from "../../domain.ts";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { IntentActorState, IntentToolDefinition, IntentToolRunState, StartToolRunMessage } from "../intent/types.ts";

export interface IntentToolRunOrchestrationHelpers {
  IntentToolRunKind: string;
  failState(state: IntentActorState, nowIso: string, reason: string, details?: JsonValue): IntentActorState;
  sendPlannerRequest(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState): IntentActorState;
  appendEvent: (state: IntentActorState, nowIso: string, type: IntentActorState["timeline"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  appendObservation: (state: IntentActorState, at: string, type: IntentActorState["observations"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  toolErrorObservation(toolId: string, message: string, details?: JsonValue): JsonValue;
  validateToolInput: (tool: IntentToolDefinition, input: JsonValue) => readonly string[];
  normalizeToolInput: (tool: IntentToolDefinition, input: JsonValue) => JsonValue;
  prepareToolInput: (tool: IntentToolDefinition, input: JsonValue, intentState: IntentActorState) => import("../intent/types.ts").PreparedToolInputResult;
  toolCatalogById: ReadonlyMap<string, IntentToolDefinition>;
  activeToolRunActorId(ctx: ActorContext<AvenRegistry, "intent">, runId: string): { toString(): string };
  clone<T>(value: T): T;
  sanitizeJson(value: JsonValue): JsonValue;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
  return `{${entries.join(",")}}`;
}

function validationFailureFingerprint(toolId: string, originalInput: JsonValue, normalizedInput: JsonValue, validationErrors: readonly string[]): string {
  const boundedOriginal = typeof originalInput === "object" && originalInput !== null
    ? JSON.parse(stableJson(originalInput).slice(0, 512)) as JsonValue
    : originalInput;
  const boundedNormalized = typeof normalizedInput === "object" && normalizedInput !== null
    ? JSON.parse(stableJson(normalizedInput).slice(0, 512)) as JsonValue
    : normalizedInput;
  return stableJson({
    toolId,
    validationErrors: [...validationErrors].sort(),
    originalInput: boundedOriginal,
    normalizedInput: boundedNormalized,
  } as JsonValue);
}

export function startToolRun(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "callTool" }>,
  helpers: IntentToolRunOrchestrationHelpers,
): IntentActorState {
  if (state.cycleToolRuns >= state.toolSettings.maxRuns) {
    return helpers.failState(state, ctx.now.toISOString(), "maxToolRuns exhausted");
  }
  const tool = helpers.toolCatalogById.get(action.toolId);
  if (!tool) {
    return helpers.failState(state, ctx.now.toISOString(), `Unknown toolId '${action.toolId}' rejected before execution.`);
  }
  if (!tool.available) {
    return helpers.sendPlannerRequest(
      ctx,
      helpers.appendObservation(
        helpers.appendEvent(
          { ...state, activePlannerRequestId: undefined, status: "running" },
          ctx.now.toISOString(),
          "error",
          `Tool '${action.toolId}' is unavailable.`,
          helpers.toolErrorObservation(action.toolId, tool.unavailableReason ?? "Tool unavailable."),
        ),
        ctx.now.toISOString(),
        "error",
        `tool unavailable: ${action.toolId}`,
        helpers.toolErrorObservation(action.toolId, tool.unavailableReason ?? "Tool unavailable."),
      ),
    );
  }
  const normalizedInput = helpers.normalizeToolInput(tool, action.input);
  const validationErrors = helpers.validateToolInput(tool, normalizedInput);
  if (validationErrors.length > 0) {
    const fingerprint = validationFailureFingerprint(action.toolId, action.input, normalizedInput, validationErrors);
    const seenFingerprints = state.toolValidationFailureFingerprints ?? [];
    const errorDetails = {
      errors: validationErrors,
      originalInput: helpers.sanitizeJson(action.input),
      normalizedInput: helpers.sanitizeJson(normalizedInput),
      fingerprint,
    } as JsonValue;
    if (seenFingerprints.includes(fingerprint)) {
      return helpers.failState(
        helpers.appendObservation(
          helpers.appendEvent(
            {
              ...state,
              activePlannerRequestId: undefined,
              status: "failed",
            },
            ctx.now.toISOString(),
            "failed",
            `Repeated invalid tool input for '${action.toolId}'.`,
            helpers.toolErrorObservation(action.toolId, "Tool input failed schema validation repeatedly.", errorDetails),
          ),
          ctx.now.toISOString(),
          "error",
          `repeated tool input invalid: ${action.toolId}`,
          helpers.toolErrorObservation(action.toolId, "Tool input failed schema validation repeatedly.", errorDetails),
        ),
        ctx.now.toISOString(),
        `Repeated invalid tool input for '${action.toolId}'.`,
        errorDetails,
      );
    }
    return helpers.sendPlannerRequest(
      ctx,
      helpers.appendObservation(
        helpers.appendEvent(
          {
            ...state,
            activePlannerRequestId: undefined,
            status: "running",
            toolValidationFailureFingerprints: [...seenFingerprints, fingerprint],
          },
          ctx.now.toISOString(),
          "error",
          `Tool input invalid for '${action.toolId}'.`,
          helpers.toolErrorObservation(action.toolId, "Tool input failed schema validation.", errorDetails),
        ),
        ctx.now.toISOString(),
        "error",
        `tool input invalid: ${action.toolId}`,
        helpers.toolErrorObservation(action.toolId, "Tool input failed schema validation.", errorDetails),
      ),
    );
  }
  const prepared = helpers.prepareToolInput(tool, normalizedInput, state);
  if (prepared.type === "error") {
    const errorDetails = {
      originalInput: helpers.sanitizeJson(action.input),
      normalizedInput: helpers.sanitizeJson(normalizedInput),
      ...(prepared.details === undefined ? {} : { details: helpers.sanitizeJson(prepared.details) }),
    } as JsonValue;
    return helpers.sendPlannerRequest(
      ctx,
      helpers.appendObservation(
        helpers.appendEvent(
          {
            ...state,
            activePlannerRequestId: undefined,
            status: "running",
          },
          ctx.now.toISOString(),
          "error",
          `Tool input preparation failed for '${action.toolId}'.`,
          helpers.toolErrorObservation(action.toolId, prepared.message, errorDetails),
        ),
        ctx.now.toISOString(),
        "error",
        `tool input preparation failed: ${action.toolId}`,
        helpers.toolErrorObservation(action.toolId, prepared.message, errorDetails),
      ),
    );
  }
  const runId = `toolrun~${state.toolRuns + 1}`;
  ctx.spawn(helpers.IntentToolRunKind as never, {
    id: helpers.activeToolRunActorId(ctx, runId) as never,
    init: {
      runId,
      toolId: tool.toolId,
      input: helpers.clone(prepared.input),
      parentIntentId: state.intentId,
      artifactReadMaxBytes: state.toolSettings.artifactReadMaxBytes,
      ...(state.selectedModels?.toolDefaults.structuredExtractionRequirements
        ? { structuredExtractionRequirements: state.selectedModels.toolDefaults.structuredExtractionRequirements }
        : {}),
      ...(state.selectedModels?.toolDefaults.structuredExtractionModelActorPathOverride
        ? { structuredExtractionModelActorPathOverride: state.selectedModels.toolDefaults.structuredExtractionModelActorPathOverride }
        : {}),
      status: "running",
    } satisfies IntentToolRunState,
  });
  ctx.send({ id: helpers.activeToolRunActorId(ctx, runId) as never, kind: helpers.IntentToolRunKind as never }, { type: "startToolRun" } satisfies StartToolRunMessage as never);
  return helpers.appendObservation(
    helpers.appendEvent(
      {
        ...state,
        status: "waitingForTool",
        activeToolRunId: runId,
        activePlannerRequestId: undefined,
        toolRuns: state.toolRuns + 1,
        cycleToolRuns: state.cycleToolRuns + 1,
      },
      ctx.now.toISOString(),
      "toolRequested",
      tool.toolId,
        { toolId: tool.toolId, input: helpers.sanitizeJson(action.input), preparedInput: helpers.sanitizeJson(prepared.input) },
    ),
    ctx.now.toISOString(),
    "plannerAction",
    "callTool",
    { toolId: tool.toolId },
  );
}
