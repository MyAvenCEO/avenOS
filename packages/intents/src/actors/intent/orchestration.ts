import { ActorId, type ActorContext, type JsonValue } from "typed-actors";
import { toReplyAddress } from "shared";
import { intentNextActionSchemaId, intentNextActionSchemaVersion, type IntentNextAction } from "../../domain.ts";
import type { IntentActorState, StartToolRunMessage, IntentToolRunState } from "./types.ts";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import { buildExternalInputRequest } from "../router/routing-prompt.ts";

export interface IntentOrchestrationHelpers {
  IntentToolRunKind: string;
  buildPlannerPrompt(state: IntentActorState): string;
  plannerRequestId(state: IntentActorState): string;
  appendEvent: (state: IntentActorState, nowIso: string, type: IntentActorState["timeline"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  appendObservation: (state: IntentActorState, at: string, type: IntentActorState["observations"][number]["type"], summary: string, data?: JsonValue) => IntentActorState;
  failState: (state: IntentActorState, nowIso: string, reason: string, details?: JsonValue) => IntentActorState;
  failWithVisibleHumanError(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState, reason: string, details?: JsonValue): IntentActorState;
  activeToolRunActorId(ctx: ActorContext<AvenRegistry, "intent">, runId: string): ActorId;
  clone<T>(value: T): T;
  sanitizeJson(value: JsonValue): JsonValue;
  validateToolInput: (tool: { inputSchema: JsonValue }, input: JsonValue) => readonly string[];
  toolCatalogById: ReadonlyMap<string, {
    toolId: string;
    available: boolean;
    unavailableReason?: string;
  }>;
  toolErrorObservation(toolId: string, message: string, details?: JsonValue): JsonValue;
}

export function sendPlannerRequest(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  helpers: Pick<IntentOrchestrationHelpers, "buildPlannerPrompt" | "plannerRequestId" | "appendEvent" | "failState" | "failWithVisibleHumanError">,
): IntentActorState {
  if (state.cycleStep >= state.plannerSettings.maxSteps) {
    return helpers.failWithVisibleHumanError(ctx, state, "maxSteps exhausted");
  }
  const requestId = helpers.plannerRequestId(state);
  ctx.send({ id: ActorId.parse("/aven/system/llms"), kind: "llms" as never }, {
    type: "submitLlmRequest",
    requestId,
    replyTo: toReplyAddress(ctx.self.id, "intent"),
    responseSchema: { schemaId: intentNextActionSchemaId, version: intentNextActionSchemaVersion },
    requirements: state.selectedModels!.plannerRequirements,
    ...(state.selectedModels!.plannerModelActorPathOverride === undefined ? {} : { preferredModelActorPath: state.selectedModels!.plannerModelActorPathOverride }),
    callerActorId: ctx.self.id.toString(),
    input: {
      messages: [{ role: "user", content: [{ kind: "text", text: helpers.buildPlannerPrompt(state) }] }],
    },
  } as never);
  return helpers.appendEvent(
    {
      ...state,
      status: "running",
      activePlannerRequestId: requestId,
      currentStep: state.currentStep + 1,
      cycleStep: state.cycleStep + 1,
    },
    ctx.now.toISOString(),
    "plannerRequested",
    "Planner requested",
    { requestId },
  );
}

export function askHuman(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "askHuman" }>,
  helpers: Pick<IntentOrchestrationHelpers, "appendEvent" | "appendObservation">,
): IntentActorState {
  const openQuestionId = `question~${state.currentStep}`;
  const communicationId = `comm~${state.intentId}~${openQuestionId}`;
  ctx.send({ id: ActorId.parse("/aven/system/human"), kind: "human" as never }, {
    type: "createCommunication",
    communicationId,
    kind: "requestInput",
    title: action.title,
    body: action.body,
    routingHint: { intentId: state.intentId, openQuestionId },
    createdBy: ctx.self.id.toString(),
  } as never);
  return helpers.appendObservation(
    helpers.appendEvent(
      {
        ...state,
        status: "waitingForHuman",
        openQuestionId,
        openCommunicationId: communicationId,
        activePlannerRequestId: undefined,
      },
      ctx.now.toISOString(),
      "humanQuestionCreated",
      action.title,
      { body: action.body },
    ),
    ctx.now.toISOString(),
    "plannerAction",
    "askHuman",
    { title: action.title },
  );
}

export function notifyHuman(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "notifyHuman" }>,
  helpers: Pick<IntentOrchestrationHelpers, "appendEvent" | "appendObservation">,
): IntentActorState {
  const communicationId = `comm~${state.intentId}~notify~${state.currentStep}`;
  ctx.send({ id: ActorId.parse("/aven/system/human"), kind: "human" as never }, {
    type: "createCommunication",
    communicationId,
    kind: action.communicationKind,
    title: action.title,
    body: action.body,
    createdBy: ctx.self.id.toString(),
  } as never);
  return helpers.appendObservation(
    helpers.appendEvent(
      {
        ...state,
        activePlannerRequestId: undefined,
      },
      ctx.now.toISOString(),
      "humanQuestionCreated",
      action.title,
      { communicationKind: action.communicationKind, body: action.body },
    ),
    ctx.now.toISOString(),
    "plannerAction",
    "notifyHuman",
    { title: action.title, communicationKind: action.communicationKind },
  );
}

export function awaitInput(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "awaitInput" }>,
  helpers: Pick<IntentOrchestrationHelpers, "appendEvent" | "appendObservation">,
): IntentActorState {
  const communicationId = `comm~${state.intentId}~await-input~${state.currentStep}`;
  ctx.send({ id: ActorId.parse("/aven/system/human"), kind: "human" as never }, {
    type: "createCommunication",
    communicationId,
    kind: "showProgress",
    title: action.title,
    body: action.body,
    createdBy: ctx.self.id.toString(),
  } as never);

  let next = helpers.appendEvent(
    {
      ...state,
      durable: true,
      externalInputRequest: buildExternalInputRequest({
        title: action.title,
        body: action.body,
        stateTitle: state.title,
        stateGoal: state.goal,
        createdAt: ctx.now.toISOString(),
      }),
      status: "waitingForExternalInput",
      activePlannerRequestId: undefined,
      openQuestionId: undefined,
      openCommunicationId: undefined,
    },
    ctx.now.toISOString(),
    "humanQuestionCreated",
    action.title,
    { communicationKind: "showProgress", body: action.body },
  );

  next = helpers.appendEvent(
    next,
    ctx.now.toISOString(),
    "awaitingExternalInput",
    "Awaiting more input",
    { title: action.title, body: action.body },
  );

  return helpers.appendObservation(
    next,
    ctx.now.toISOString(),
    "plannerAction",
    "awaitInput",
    { title: action.title },
  );
}
