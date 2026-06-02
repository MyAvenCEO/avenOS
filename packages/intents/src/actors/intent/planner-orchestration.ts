import type { ActorContext, JsonValue } from "typed-actors";
import type { IntentNextAction } from "../../domain.ts";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { HumanReplyMessage, IntentActorState, ToolRunCompletedMessage } from "./types.ts";
import type { LlmResult } from "llm-contracts";

export interface IntentPlannerCompletionHelpers {
  actionFromPlanner(result: LlmResult): { readonly type: "ok"; readonly value: IntentNextAction } | { readonly type: "error"; readonly message: string; readonly details?: JsonValue };
  failState(state: IntentActorState, nowIso: string, reason: string, details?: JsonValue): IntentActorState;
  failWithVisibleHumanError(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState, reason: string, details?: JsonValue): IntentActorState;
  appendEvent: (state: IntentActorState, nowIso: string, type: IntentActorState["timeline"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  appendObservation: (state: IntentActorState, at: string, type: IntentActorState["observations"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  sendPlannerRequest(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState): IntentActorState;
  askHuman(
    ctx: ActorContext<AvenRegistry, "intent">,
    state: IntentActorState,
    action: Extract<IntentNextAction, { kind: "askHuman" }>,
  ): IntentActorState;
  notifyHuman(
    ctx: ActorContext<AvenRegistry, "intent">,
    state: IntentActorState,
    action: Extract<IntentNextAction, { kind: "notifyHuman" }>,
  ): IntentActorState;
  awaitInput(
    ctx: ActorContext<AvenRegistry, "intent">,
    state: IntentActorState,
    action: Extract<IntentNextAction, { kind: "awaitInput" }>,
  ): IntentActorState;
  startToolRun(
    ctx: ActorContext<AvenRegistry, "intent">,
    state: IntentActorState,
    action: Extract<IntentNextAction, { kind: "callTool" }>,
  ): IntentActorState;
  completeState(state: IntentActorState, nowIso: string, result: JsonValue): IntentActorState;
  reopenDurableThread(state: IntentActorState, nowIso: string, result: JsonValue): IntentActorState;
  createFinalHumanResult(
    ctx: ActorContext<AvenRegistry, "intent">,
    state: IntentActorState,
    payload: { readonly title: string; readonly body: string },
  ): IntentActorState;
  createFailureHumanMessage(
    ctx: ActorContext<AvenRegistry, "intent">,
    state: IntentActorState,
    payload: { readonly title: string; readonly body: string; readonly communicationKind?: "showError" | "showBlocked" },
  ): IntentActorState;
}

export interface IntentPlannerReentryHelpers {
  appendEvent: (state: IntentActorState, nowIso: string, type: IntentActorState["timeline"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  appendObservation: (state: IntentActorState, at: string, type: IntentActorState["observations"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  sendPlannerRequest(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState): IntentActorState;
  clone<T>(value: T): T;
  sanitizeJson(value: JsonValue): JsonValue;
}

function normalizePlannerToolResult(message: ToolRunCompletedMessage, helpers: Pick<IntentPlannerReentryHelpers, "sanitizeJson">): JsonValue {
  const sanitizedInput = helpers.sanitizeJson(message.input);
  const sanitizedResult = helpers.sanitizeJson(message.result);
  const resultRecord = sanitizedResult && typeof sanitizedResult === "object" && !Array.isArray(sanitizedResult)
    ? sanitizedResult as Record<string, JsonValue>
    : undefined;

  const isShellCompletion = resultRecord?.type === "shell.execute.completion";
  const exitCode = typeof resultRecord?.exitCode === "number" ? resultRecord.exitCode : undefined;
  const timedOut = resultRecord?.timedOut === true;
  const isTypedError = resultRecord?.type === "error";
  const outcome = isTypedError || (isShellCompletion && (timedOut || exitCode !== 0)) ? "error" : "success";
  const summary = outcome === "success"
    ? `The tool '${message.toolId}' completed successfully.`
    : `The tool '${message.toolId}' completed with an error or incomplete outcome.`;
  const nextActionHint = outcome === "success"
    ? "If this likely satisfied the user's goal, return kind='complete'. If more confidence is needed, choose a verification step instead of repeating the same tool call."
    : "If the goal is not satisfied, choose a different next action, ask for clarification, or fail with a precise reason instead of repeating the same unsuccessful step without new evidence.";

  if (resultRecord) {
    return {
      ...resultRecord,
      toolId: message.toolId,
      input: sanitizedInput,
      outcome,
      summary,
      nextActionHint,
    } as JsonValue;
  }

  return {
    type: "toolResult",
    toolId: message.toolId,
    outcome,
    summary,
    input: sanitizedInput,
    result: sanitizedResult,
    nextActionHint,
  } as JsonValue;
}

export interface IntentPlannerStartContinueHelpers {
  failState(state: IntentActorState, nowIso: string, reason: string, details?: JsonValue): IntentActorState;
  failWithVisibleHumanError(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState, reason: string, details?: JsonValue): IntentActorState;
  appendEvent: (state: IntentActorState, nowIso: string, type: IntentActorState["timeline"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  appendObservation: (state: IntentActorState, at: string, type: IntentActorState["observations"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  sendPlannerRequest(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState): IntentActorState;
}

export function applyPlannerCompletion(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  result: LlmResult,
  helpers: IntentPlannerCompletionHelpers,
): IntentActorState {
  const parsed = helpers.actionFromPlanner(result);
  if (parsed.type === "error") {
    return helpers.failWithVisibleHumanError(ctx, state, parsed.message, parsed.details);
  }
  const action = parsed.value;

  let next = helpers.appendEvent(
    state,
    ctx.now.toISOString(),
    "plannerActionAccepted",
    action.kind,
    action as unknown as JsonValue,
  );

  switch (action.kind) {
    case "askHuman":
      return helpers.askHuman(ctx, next, action);
    case "notifyHuman":
      next = helpers.notifyHuman(ctx, next, action);
      return helpers.sendPlannerRequest(ctx, next);
    case "awaitInput":
      return helpers.awaitInput(ctx, next, action);
    case "callTool":
      return helpers.startToolRun(ctx, next, action);
    case "complete":
      if (next.durable) {
        if (next.requiresHumanVisibleResult && action.humanResult) {
          next = helpers.createFinalHumanResult(ctx, next, action.humanResult);
        }
        return helpers.reopenDurableThread(next, ctx.now.toISOString(), action.result);
      }
      if (next.requiresHumanVisibleResult) {
        if (action.humanResult) {
          next = helpers.createFinalHumanResult(ctx, next, action.humanResult);
          return helpers.completeState(next, ctx.now.toISOString(), action.result);
        }
        const retryCount = next.missingHumanResultRetries ?? 0;
        if (retryCount < 1) {
          const nowIso = ctx.now.toISOString();
          next = helpers.appendObservation(
            {
              ...helpers.appendEvent(next, nowIso, "error", "Planner must include complete.humanResult for human-origin intents."),
              missingHumanResultRetries: retryCount + 1,
            },
            nowIso,
            "error",
            "Missing complete.humanResult for human-origin intent.",
          );
          return helpers.sendPlannerRequest(ctx, next);
        }
        next = helpers.createFailureHumanMessage(ctx, next, {
          title: "Intent failed",
          body: "The planner finished without providing the required human-visible result message.",
          communicationKind: "showError",
        });
        return helpers.failWithVisibleHumanError(ctx, next, "planner missing complete.humanResult");
      }
      return helpers.completeState(next, ctx.now.toISOString(), action.result);
    case "fail":
      if (next.requiresHumanVisibleResult && action.humanError) {
        next = helpers.createFailureHumanMessage(ctx, next, action.humanError);
      }
      return helpers.failWithVisibleHumanError(ctx, next, action.reason);
  }
}

export function resumePlannerAfterToolRun(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  message: ToolRunCompletedMessage,
  helpers: IntentPlannerReentryHelpers,
): IntentActorState {
  const plannerToolResult = normalizePlannerToolResult(message, helpers);
  let next = helpers.appendObservation(
    helpers.appendEvent(
      { ...state, activeToolRunId: undefined, status: "running" },
      ctx.now.toISOString(),
      "toolCompleted",
      message.runId,
      plannerToolResult,
    ),
    ctx.now.toISOString(),
    "toolResult",
    message.runId,
    plannerToolResult,
  );
  next = helpers.sendPlannerRequest(ctx, next);
  return next;
}

export function resumePlannerAfterHumanReply(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  message: HumanReplyMessage,
  helpers: IntentPlannerReentryHelpers,
): IntentActorState {
  let next = helpers.appendObservation(
    helpers.appendEvent(
      {
        ...state,
        humanAnswers: [...state.humanAnswers, helpers.clone(message.answer)],
        openQuestionId: undefined,
        openCommunicationId: undefined,
        status: "running",
      },
      ctx.now.toISOString(),
      "humanReplyReceived",
      "Human replied",
      { answer: message.answer },
    ),
    ctx.now.toISOString(),
    "humanReply",
    "Human reply",
    message.answer,
  );
  next = helpers.sendPlannerRequest(ctx, next);
  return next;
}

export function resumePlannerAfterExternalInput(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  input: JsonValue,
  helpers: IntentPlannerReentryHelpers,
): IntentActorState {
  let next = helpers.appendObservation(
    helpers.appendEvent(
      {
        ...state,
        input: helpers.clone(input),
        status: "running",
        openQuestionId: undefined,
        openCommunicationId: undefined,
      },
      ctx.now.toISOString(),
      "humanReplyReceived",
      "Human sent follow-up input",
      { answer: input },
    ),
    ctx.now.toISOString(),
    "humanReply",
    "Human follow-up input",
    input,
  );
  next = helpers.sendPlannerRequest(ctx, next);
  return next;
}

export function startIntentPlanning(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  helpers: IntentPlannerStartContinueHelpers,
): IntentActorState {
  if (!state.selectedModels?.plannerRequirements) {
    return helpers.failWithVisibleHumanError(ctx, state, "planner requirements are required");
  }

  let next = helpers.appendEvent(state, ctx.now.toISOString(), "created", "Intent created", {
    plannerRequirements: state.selectedModels.plannerRequirements as unknown as JsonValue,
    plannerModelActorPathOverride: state.selectedModels.plannerModelActorPathOverride,
    toolDefaults: state.selectedModels.toolDefaults as unknown as JsonValue,
  } as unknown as JsonValue);
  next = helpers.appendEvent({ ...next, status: "running" }, ctx.now.toISOString(), "started", "Intent started");
  next = helpers.sendPlannerRequest(ctx, next);
  return next;
}

export function continueIntentPlanning(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  helpers: IntentPlannerStartContinueHelpers,
): IntentActorState {
  if (state.status === "waitingForTool" || state.activeToolRunId) {
    return helpers.appendObservation(
      helpers.appendEvent(state, ctx.now.toISOString(), "error", "Cannot continue while a tool run is active."),
      ctx.now.toISOString(),
      "error",
      "tool run still active",
    );
  }
  if (state.status === "waitingForHuman") {
    return helpers.appendObservation(
      helpers.appendEvent(state, ctx.now.toISOString(), "error", "Cannot continue while waiting for human input."),
      ctx.now.toISOString(),
      "error",
      "waiting for human input",
    );
  }
  return helpers.sendPlannerRequest(ctx, state);
}