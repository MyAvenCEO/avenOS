import type { JsonValue } from "typed-actors";
import type { LlmResult } from "llm-contracts";
import type { IntentNextAction, ParseResult } from "../../domain.ts";
import type { IntentActorState, IntentToolDefinition } from "./types.ts";
import { listCurrentDefaultExtractionSchemas } from "../../../../schema/src/extraction-schemas.ts";

function isRecord(value: JsonValue | undefined | null): value is Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function availableArtifactsFromState(state: IntentActorState): readonly {
  readonly artifactId: string;
  readonly filename?: string;
  readonly effectiveMimeType?: string;
  readonly declaredMimeType?: string;
  readonly mediaRole?: string;
  readonly sizeBytes?: number;
}[] {
  const sourceInput = isRecord(state.input) ? state.input : undefined;
  const attachments = Array.isArray(sourceInput?.attachments) ? sourceInput.attachments : [];
  return attachments.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const ref = isRecord(entry.ref) ? entry.ref : undefined;
    const blob = ref && isRecord(ref.blob) ? ref.blob : undefined;
    if (typeof ref?.artifactId !== "string") return [];
    return [{
      artifactId: ref.artifactId,
      ...(typeof entry.filename === "string" ? { filename: entry.filename } : {}),
      ...(typeof entry.effectiveMimeType === "string" ? { effectiveMimeType: entry.effectiveMimeType } : {}),
      ...(typeof entry.declaredMimeType === "string" ? { declaredMimeType: entry.declaredMimeType } : {}),
      ...(typeof entry.mediaRole === "string" ? { mediaRole: entry.mediaRole } : {}),
      ...(typeof blob?.sizeBytes === "number" ? { sizeBytes: blob.sizeBytes } : {}),
    }];
  });
}

export interface IntentPlannerFlowHelpers {
  sanitizeJson(value: JsonValue): JsonValue;
  bounded(value: JsonValue): JsonValue;
  listIntentToolCatalog(): readonly IntentToolDefinition[];
  appendEvent: (state: IntentActorState, nowIso: string, type: IntentActorState["timeline"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  appendObservation: (state: IntentActorState, at: string, type: IntentActorState["observations"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
}

function repairToolShapedPlannerAction(value: Record<string, unknown>, knownToolIds: ReadonlySet<string>): IntentNextAction | undefined {
  if (typeof value.kind !== "string") {
    return undefined;
  }
  if (!knownToolIds.has(value.kind)) {
    return undefined;
  }
  const { kind, rationaleSummary, input, ...rest } = value;

  let normalizedInput: JsonValue | undefined;
  if (input !== undefined) {
    normalizedInput = input as JsonValue;
  } else {
    const restKeys = Object.keys(rest);
    if (restKeys.length === 0) {
      return undefined;
    }
    normalizedInput = rest as JsonValue;
  }

  const repaired: IntentNextAction = {
    kind: "callTool",
    toolId: value.kind,
    input: normalizedInput,
    ...(typeof value.rationaleSummary === "string" ? { rationaleSummary: value.rationaleSummary } : {}),
  };
  return repaired;
}

export function buildPlannerPrompt(state: IntentActorState, helpers: Pick<IntentPlannerFlowHelpers, "sanitizeJson" | "bounded" | "listIntentToolCatalog">): string {
  const compactToolCatalog = helpers.listIntentToolCatalog().map((tool) => ({
    toolId: tool.toolId,
    purpose: tool.description,
    arguments: typeof tool.inputSchema === "object" && tool.inputSchema !== null && !Array.isArray(tool.inputSchema)
      ? Object.keys(((tool.inputSchema as Record<string, JsonValue>).properties as Record<string, JsonValue> | undefined) ?? {})
      : [],
    available: tool.available,
    ...(tool.unavailableReason ? { unavailableReason: tool.unavailableReason } : {}),
    mutates: tool.mutates,
    output: tool.outputDescription,
  }));
  const fullToolCatalog = helpers.listIntentToolCatalog().map((tool) => ({
    toolId: tool.toolId,
    title: tool.title,
    description: tool.description,
    available: tool.available,
    ...(tool.unavailableReason ? { unavailableReason: tool.unavailableReason } : {}),
    mutates: tool.mutates,
    inputSchema: helpers.bounded(helpers.sanitizeJson(tool.inputSchema)),
    output: tool.outputDescription,
  }));
  const plannerInput = {
    goal: state.goal,
    input: state.input === undefined ? null : helpers.bounded(helpers.sanitizeJson(state.input)),
    status: state.status,
    shellContext: state.shellContext,
    observations: state.observations.slice(-3).map((entry) => ({
      at: entry.at,
      type: entry.type,
      summary: entry.summary.slice(0, state.plannerSettings.maxObservationChars),
      ...(entry.data === undefined ? {} : { data: helpers.bounded(helpers.sanitizeJson(entry.data)) }),
    })),
    availableArtifacts: availableArtifactsFromState(state),
    availableExtractionSchemas: listCurrentDefaultExtractionSchemas().map((entry) => ({
      schemaId: entry.schemaId,
      name: entry.name,
      description: entry.description,
    })),
    tools: state.plannerSettings.toolCatalogMode === "full" ? fullToolCatalog : compactToolCatalog,
    currentStep: state.cycleStep,
    globalStep: state.currentStep,
    requiresHumanVisibleResult: state.requiresHumanVisibleResult,
  };
  const prompt = [
    "You are the intent planner.",
    "Decision policy:",
    "1. If the request is a simple knowledge question that can be answered from general knowledge, answer it yourself. Do not ask the human to supply the answer.",
    "2. Ask the human only when information is genuinely missing, ambiguous, preference-dependent, private to the user, or approval is required for a mutation.",
    "3. A valid askHuman question must request missing information the human is likely to know and that is needed to proceed.",
    "4. Do not ask the human to repeat, explain, or answer their own original request unless you are explicitly asking for clarification.",
    "5. After a tool succeeds, assume the tool result is usable evidence unless there is concrete evidence it failed to satisfy the goal.",
    "6. When the task is finished, return kind='complete'. If this intent came from a human, include humanResult.title and humanResult.body. The runtime will show that message to the human and complete the intent atomically.",
    "7. If the user's goal is intentionally open-ended or ongoing, and you should remain available for future messages, attachments, or updates, return kind='awaitInput' instead of kind='complete'.",
    "8. Once you have already established an ongoing durable thread with kind='awaitInput', later follow-up work may return kind='complete' for the current subtask result; the runtime will keep the durable thread open afterward.",
    "Return exactly one JSON object that matches the required action schema.",
    "The JSON object MUST contain a top-level 'kind' property.",
    "Do not return objects like {status, response}.",
    "Do not wrap the answer in markdown fences.",
    "Respond with raw JSON only: exactly one object, with no surrounding prose or commentary.",
    "Allowed action shapes:",
    '- {"kind":"callTool","toolId":"<tool id>","input":<json>,"rationaleSummary":"<optional short reason>"}',
    '- {"kind":"askHuman","title":"<short title>","body":"<question for the human>","rationaleSummary":"<optional short reason>"}',
    '- {"kind":"notifyHuman","communicationKind":"showProgress|showWarning|showError|showBlocked","title":"<short title>","body":"<message>","rationaleSummary":"<optional short reason>"}',
    '- {"kind":"awaitInput","title":"<short title>","body":"<message describing what future input you are waiting for>","rationaleSummary":"<optional short reason>"}',
    '- {"kind":"complete","result":<json>,"humanResult":{"title":"<title>","body":"<body>"},"rationaleSummary":"<optional short reason>"}',
    '- {"kind":"fail","reason":"<short reason>","humanError":{"title":"<title>","body":"<body>","communicationKind":"showError|showBlocked"},"rationaleSummary":"<optional short reason>"}',
    "Never use any top-level properties other than those allowed by one of the shapes above.",
    "If a tool is unavailable, do not call it.",
    "If you need human input, use kind='askHuman' instead of inventing a response wrapper.",
    "Good reasons to askHuman: missing user preference, ambiguous target or scope, missing private or local information not available in context, permission or approval needed for a mutation, or a required external fact that is unavailable and not recoverable via tools.",
    "Do not ask for clarification unless the ambiguity materially changes the answer or the next action.",
    "Bad askHuman examples: asking the human to answer their own factual question, asking the human to explain a concept they asked you to explain, or asking for information already present in context or tool output.",
    "When a recent observation shows that a tool completed successfully, first determine whether the user's goal is already satisfied.",
    "If the goal is satisfied, return {\"kind\":\"complete\", ...}.",
    "Do not repeat the same tool call after a successful result unless you have concrete evidence that the previous call did not achieve the goal.",
    "Do not repeat the same tool call after an error with the same input unless you have new evidence, a materially different instruction, or a concrete recovery strategy that addresses the specific failure.",
    "If a tool error is already human-visible via notifyHuman, do not emit another notifyHuman with the same underlying error unless the situation materially changed.",
    "If verification is needed, prefer a verification step over repeating the same mutation.",
    "Successful tool execution means the tool call itself succeeded. You must still decide whether the user's goal is now complete.",
    "Use the tool result details, including the tool input and any command or output previews, to decide whether to complete, verify, or choose a different next action.",
    "For structured extraction, call structuredExtraction.extract with exactly artifactId, schemaId, and optional instruction.",
    "Choose artifactId from availableArtifacts.",
    "Choose schemaId from availableExtractionSchemas.",
    "Never include blob, ref, mediaRole, schema, schemaRef, version, provider, model, or LLM actor path in tool input.",
    "schema.get is only for explicit user requests to inspect a schema; do not call schema.get before structuredExtraction.extract.",
    "Final reminder: output only one minified JSON object matching exactly one allowed action shape.",
    "Planner state:",
    JSON.stringify(plannerInput),
  ].join("\n");
  return prompt.length <= state.plannerSettings.maxPromptChars
    ? prompt
    : `${prompt.slice(0, state.plannerSettings.maxPromptChars)}\n[planner prompt truncated]`;
}

export function plannerRequestId(state: IntentActorState): string {
  return `${state.intentId}~planner~${state.currentStep + 1}`;
}

export function completeState(
  state: IntentActorState,
  nowIso: string,
  result: JsonValue,
  helpers: Pick<IntentPlannerFlowHelpers, "appendEvent" | "appendObservation">,
): IntentActorState {
  return helpers.appendObservation(
    helpers.appendEvent(
      {
        ...state,
        status: "completed",
        activeToolRunId: undefined,
        activePlannerRequestId: undefined,
        openQuestionId: undefined,
        openCommunicationId: undefined,
        externalInputRequest: undefined,
      },
      nowIso,
      "completed",
      "Intent completed",
      result,
    ),
    nowIso,
    "status",
    "completed",
    result,
  );
}

export function failState(
  state: IntentActorState,
  nowIso: string,
  reason: string,
  details: JsonValue | undefined,
  helpers: Pick<IntentPlannerFlowHelpers, "appendEvent" | "appendObservation">,
): IntentActorState {
  return helpers.appendObservation(
    helpers.appendEvent(
      { ...state, status: "failed", activeToolRunId: undefined, activePlannerRequestId: undefined },
      nowIso,
      "failed",
      reason,
      details,
    ),
    nowIso,
    "error",
    reason,
    details,
  );
}

export function cancelState(
  state: IntentActorState,
  nowIso: string,
  reason: string,
  details: JsonValue | undefined,
  helpers: Pick<IntentPlannerFlowHelpers, "appendEvent" | "appendObservation">,
): IntentActorState {
  return helpers.appendObservation(
    helpers.appendEvent(
      { ...state, status: "cancelled", activeToolRunId: undefined, activePlannerRequestId: undefined, externalInputRequest: undefined },
      nowIso,
      "cancelled",
      reason,
      details,
    ),
    nowIso,
    "error",
    reason,
    details,
  );
}

export function parseIntentNextAction(value: unknown): ParseResult<IntentNextAction> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { type: "error", message: "planner action must be an object" };
  }
  const entry = value as Record<string, unknown>;
  const repaired = repairToolShapedPlannerAction(entry, new Set([
    "shell.execute",
    "intent.readArtifact",
    "metadata.queryRecords",
    "metadata.createRecord",
    "metadata.getRecord",
    "structuredExtraction.extract",
    "artifact.getDescriptor",
    "schema.get",
    "schema.validateJson",
  ]));
  if (repaired) {
    return { type: "ok", value: repaired };
  }
  if (entry.kind === "callTool" && typeof entry.toolId === "string" && "input" in entry) {
    return { type: "ok", value: entry as IntentNextAction };
  }
  if (entry.kind === "askHuman" && typeof entry.title === "string" && typeof entry.body === "string") {
    return { type: "ok", value: entry as IntentNextAction };
  }
  if (entry.kind === "notifyHuman" && typeof entry.title === "string" && typeof entry.body === "string"
    && (entry.communicationKind === "showProgress" || entry.communicationKind === "showWarning" || entry.communicationKind === "showError" || entry.communicationKind === "showBlocked")) {
    return { type: "ok", value: entry as IntentNextAction };
  }
  if (entry.kind === "awaitInput" && typeof entry.title === "string" && typeof entry.body === "string") {
    return { type: "ok", value: entry as IntentNextAction };
  }
  if (entry.kind === "complete" && "result" in entry) {
    if (entry.humanResult !== undefined) {
      const hr = entry.humanResult as Record<string, unknown>;
      if (typeof hr?.title !== "string" || typeof hr?.body !== "string") {
        return { type: "error", message: "complete.humanResult must contain title and body" };
      }
    }
    return { type: "ok", value: entry as IntentNextAction };
  }
  if (entry.kind === "fail" && typeof entry.reason === "string") {
    if (entry.humanError !== undefined) {
      const he = entry.humanError as Record<string, unknown>;
      if (typeof he?.title !== "string" || typeof he?.body !== "string") {
        return { type: "error", message: "fail.humanError must contain title and body" };
      }
    }
    return { type: "ok", value: entry as IntentNextAction };
  }
  return { type: "error", message: "planner action shape is invalid", details: value as JsonValue };
}

export function actionFromPlanner(result: LlmResult): ParseResult<IntentNextAction> {
  if (result.type === "error") {
    return {
      type: "error",
      message: `planner provider/model error: ${result.error.message}`,
      details: result as unknown as JsonValue,
    };
  }
  const json = result.output.find((part) => part.kind === "json");
  if (json?.kind !== "json") {
    return { type: "error", message: "planner output missing json action", details: result as unknown as JsonValue };
  }
  return parseIntentNextAction(json.value);
}

export function toolErrorObservation(
  toolId: string,
  message: string,
  details: JsonValue | undefined,
  sanitizeJson: (value: JsonValue) => JsonValue,
): JsonValue {
  return {
    type: "toolError",
    toolId,
    message,
    ...(details === undefined ? {} : { details: sanitizeJson(details) }),
  } as JsonValue;
}
