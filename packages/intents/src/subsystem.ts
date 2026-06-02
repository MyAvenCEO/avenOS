import {
  ActorId,
  type ActorContext,
  type ActorDefinitionMap,
  type JsonValue,
} from "typed-actors";
import { ErrorCategory } from "actor-contracts";
import type { ActorTreePresentationMap } from "typed-actors-introspection";
import type {
  ArtifactGetDescriptorCompleted,
  ArtifactGetDescriptorRequest,
} from "artifact-contracts";
import type { LlmRequestCompleted, LlmResult } from "llm-contracts";
import type { DebugMessageDescriptor, AvenRegistry } from "../../runtime/src/spine.ts";
import type {
  ConfigureIntentRuntimeMessage,
  CreateIntentMessage,
  HumanReplyReceived,
  IntentRuntimeConfig,
  GetRoutingCardMessage,
  ListIntentsMessage,
  RouteHumanMessage,
} from "intents-contracts";
import type {
  GetSchemaVersionRequest,
  SchemaValidationCompleted,
  SchemaVersionCompleted,
  ValidateJsonRequest,
} from "schema-contracts";
import {
  intentNextActionSchemaId,
  intentNextActionSchemaVersion,
  type IntentNextAction,
  type IntentObservation,
  type IntentRoutingCard,
  type IntentSelectedModels,
  type IntentStatus,
  type IntentTimelineEvent,
} from "./domain.ts";
import type { SchemaRef } from "../../schema/src/domain.ts";
import { toReplyAddress } from "../../shared/src/index.ts";
import { IntentActor } from "./actors/intent/actor.ts";
import { IntentToolRunActor } from "./actors/tool-run/actor.ts";
import { IntentsRouterActor } from "./actors/router/actor.ts";
import type {
  IntentActorState,
  IntentRoutingCardUpdated,
  IntentToolDefinition,
  IntentToolRunState,
} from "./actors/intent/types.ts";
import { selectedModels } from "./actors/intent/runtime-selection.ts";
import {
  intentActorRuntime,
} from "./actors/intent/shape.ts";
import { intentsRouterRuntime } from "./actors/router/shape.ts";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_TOOL_RUNS = 8;

export type {
  ConfigureIntentRuntimeMessage,
  CreateIntentMessage,
  GetRoutingCardMessage,
  HumanReplyReceived,
  IntentRuntimeConfig,
  ListIntentsMessage,
  RouteHumanMessage,
} from "intents-contracts";
export type { IntentRuntimeConfigInit } from "./domain.ts";

export type { ArtifactDescriptorCompletedMessage, CancelIntentMessage, ContinueIntentMessage, GetIntentMessage, HumanInputMessage, HumanReplyMessage, IntentActorInit, IntentActorMessage, IntentActorState, IntentRoutingCardUpdated, IntentToolDefinition, IntentToolRunMessage, IntentToolRunState, IntentsRouterMessage, IntentsRouterState, LlmRequestCompletedMessage, MetadataQueryCompletedMessage, MetadataRecordCompletedMessage, PlannerCompletedMessage, SchemaValidationCompletedMessage, SchemaVersionCompletedMessage, StartIntentMessage, StartToolRunMessage, StructuredExtractionCompletedMessage, ToolRunCompletedMessage } from "./actors/intent/types.ts";
import { completeToolRunResult, listIntentToolCatalog, normalizeIntentToolInput, prepareIntentToolInput, validateToolInput, type IntentToolCatalogHelpers } from "./actors/intent/tool-catalog.ts";
import { appendEvent, appendObservation, bounded, clone, intentError, notifyRouterCard, sanitizeJson } from "./actors/intent/support.ts";
import { actionFromPlanner as plannerActionFromResult, buildPlannerPrompt, completeState as plannerCompleteState, failState as plannerFailState, plannerRequestId, toolErrorObservation as plannerToolErrorObservation } from "./actors/intent/planner-flow.ts";
import { askHuman as orchestrationAskHuman, awaitInput as orchestrationAwaitInput, notifyHuman as orchestrationNotifyHuman, sendPlannerRequest as orchestrationSendPlannerRequest } from "./actors/intent/orchestration.ts";
import type { IntentPlannerCompletionHelpers, IntentPlannerReentryHelpers, IntentPlannerStartContinueHelpers } from "./actors/intent/planner-orchestration.ts";
import { startToolRun as orchestratedStartToolRun } from "./actors/tool-run/orchestration.ts";

export const IntentToolRunKind = "intentToolRun" as const;

export const intentsDebugMessageDescriptors = intentsRouterRuntime.debugDescriptors as readonly DebugMessageDescriptor[];

export const intentDebugMessageDescriptors = intentActorRuntime.debugDescriptors as readonly DebugMessageDescriptor[];

function activeToolRunActorId(ctx: ActorContext<AvenRegistry, "intent">, runId: string): ActorId {
  return ctx.self.id.child(runId);
}

function notifyRouterCardForIntent(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState): void {
  notifyRouterCard(ctx, state, (routingCard) => ({ type: "intentRoutingCardUpdated", routingCard } satisfies IntentRoutingCardUpdated));
}

function completeState(state: IntentActorState, nowIso: string, result: JsonValue): IntentActorState {
  return plannerCompleteState(state, nowIso, result, { appendEvent, appendObservation });
}

function failState(state: IntentActorState, nowIso: string, reason: string, details?: JsonValue): IntentActorState {
  return plannerFailState(state, nowIso, reason, details, { appendEvent, appendObservation });
}

function hasVisibleTerminalFailureCommunication(state: IntentActorState): boolean {
  return state.observations.some((entry) => entry.type === "plannerAction" && entry.summary === "fail.humanError");
}

function failWithVisibleHumanError(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  reason: string,
  details?: JsonValue,
): IntentActorState {
  let next = state;
  if (state.requiresHumanVisibleResult && !hasVisibleTerminalFailureCommunication(state)) {
    next = createFailureHumanMessage(ctx, state, {
      title: "I couldn't complete this",
      body: `${reason}. The technical details are stored in the intent timeline.`,
      communicationKind: "showError",
    });
  }
  return failState(next, ctx.now.toISOString(), reason, details);
}

function actionFromPlanner(result: LlmResult) {
  return plannerActionFromResult(result);
}

function createFinalHumanResult(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  payload: { readonly title: string; readonly body: string },
): IntentActorState {
  const communicationId = `comm~${state.intentId}~result~${state.currentStep}`;
  ctx.send({ id: ActorId.parse("/aven/system/human"), kind: "human" as never }, {
    type: "createCommunication",
    communicationId,
    kind: "showResult",
    title: payload.title,
    body: payload.body,
    createdBy: ctx.self.id.toString(),
  } as never);
  return appendObservation(
    appendEvent(
      { ...state, activePlannerRequestId: undefined },
      ctx.now.toISOString(),
      "humanQuestionCreated",
      payload.title,
      { communicationKind: "showResult", body: payload.body },
    ),
    ctx.now.toISOString(),
    "plannerAction",
    "complete.humanResult",
    { title: payload.title, communicationKind: "showResult" },
  );
}

function createFailureHumanMessage(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  payload: { readonly title: string; readonly body: string; readonly communicationKind?: "showError" | "showBlocked" },
): IntentActorState {
  const communicationKind = payload.communicationKind ?? "showError";
  const communicationId = `comm~${state.intentId}~failure~${state.currentStep}`;
  ctx.send({ id: ActorId.parse("/aven/system/human"), kind: "human" as never }, {
    type: "createCommunication",
    communicationId,
    kind: communicationKind,
    title: payload.title,
    body: payload.body,
    createdBy: ctx.self.id.toString(),
  } as never);
  return appendObservation(
    appendEvent(
      { ...state, activePlannerRequestId: undefined },
      ctx.now.toISOString(),
      "humanQuestionCreated",
      payload.title,
      { communicationKind, body: payload.body },
    ),
    ctx.now.toISOString(),
    "plannerAction",
    "fail.humanError",
    { title: payload.title, communicationKind },
  );
}

function reopenDurableThread(state: IntentActorState, nowIso: string, result: JsonValue): IntentActorState {
  return appendObservation(
    appendEvent(
      {
        ...state,
        durable: true,
        status: "waitingForExternalInput",
        activePlannerRequestId: undefined,
        activeToolRunId: undefined,
        openQuestionId: undefined,
        openCommunicationId: undefined,
        cycleStep: 0,
        cycleToolRuns: 0,
        toolValidationFailureFingerprints: undefined,
        missingHumanResultRetries: undefined,
      },
      nowIso,
      "awaitingExternalInput",
      "Durable thread remains open",
      result,
    ),
    nowIso,
    "status",
    "waitingForExternalInput",
    result,
  );
}

function toolErrorObservation(toolId: string, message: string, details?: JsonValue): JsonValue {
  return plannerToolErrorObservation(toolId, message, details, sanitizeJson);
}

function sendPlannerRequest(ctx: ActorContext<AvenRegistry, "intent">, state: IntentActorState): IntentActorState {
  return orchestrationSendPlannerRequest(ctx, state, {
    buildPlannerPrompt: (entry) => buildPlannerPrompt(entry, { sanitizeJson, bounded, listIntentToolCatalog: () => listIntentToolCatalog(intentToolCatalogHelpers) }),
    plannerRequestId,
    appendEvent,
    failState,
    failWithVisibleHumanError,
  });
}

const intentToolCatalogHelpers: IntentToolCatalogHelpers = {
  IntentToolRunKind,
  clone,
  sanitizeJson,
  bounded,
};

const toolCatalogById = new Map<string, IntentToolDefinition>(
  listIntentToolCatalog(intentToolCatalogHelpers).map((tool) => [tool.toolId, tool]),
);

function askHuman(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "askHuman" }>,
): IntentActorState {
  return orchestrationAskHuman(ctx, state, action, { appendEvent, appendObservation });
}

function notifyHuman(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "notifyHuman" }>,
): IntentActorState {
  return orchestrationNotifyHuman(ctx, state, action, { appendEvent, appendObservation });
}

function awaitInput(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "awaitInput" }>,
): IntentActorState {
  return orchestrationAwaitInput(ctx, state, action, { appendEvent, appendObservation });
}

function startToolRun(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  action: Extract<IntentNextAction, { kind: "callTool" }>,
): IntentActorState {
  return orchestratedStartToolRun(ctx, state, action, {
    IntentToolRunKind,
    failState,
    sendPlannerRequest,
    appendEvent,
    appendObservation,
    toolErrorObservation,
    validateToolInput,
    normalizeToolInput: normalizeIntentToolInput,
    prepareToolInput: prepareIntentToolInput,
    toolCatalogById,
    activeToolRunActorId,
    clone,
    sanitizeJson,
  });
}

export type IntentRuntimeActorKind = typeof import("../../runtime/src/spine.ts").ActorKind;

export interface BuildIntentSubsystemArgs {
  readonly registry: AvenRegistry;
  readonly ActorKind: IntentRuntimeActorKind;
}

export interface IntentSubsystemSupport {
  readonly registry: AvenRegistry;
  readonly ActorKind: IntentRuntimeActorKind;
  readonly IntentToolRunKind: typeof IntentToolRunKind;
  readonly clone: typeof clone;
  readonly sanitizeJson: typeof sanitizeJson;
  readonly intentError: typeof intentError;
  readonly selectedModels: typeof selectedModels;
  readonly appendEvent: typeof appendEvent;
  readonly appendObservation: typeof appendObservation;
  readonly notifyRouterCard: typeof notifyRouterCardForIntent;
  readonly sendPlannerRequest: typeof sendPlannerRequest;
  readonly actionFromPlanner: typeof actionFromPlanner;
  readonly askHuman: typeof askHuman;
  readonly notifyHuman: typeof notifyHuman;
  readonly awaitInput: typeof awaitInput;
  readonly startToolRun: typeof startToolRun;
  readonly completeState: (state: IntentActorState, nowIso: string, result: JsonValue) => IntentActorState;
  readonly failState: (state: IntentActorState, nowIso: string, reason: string, details?: JsonValue) => IntentActorState;
  readonly failWithVisibleHumanError: typeof failWithVisibleHumanError;
  readonly reopenDurableThread: typeof reopenDurableThread;
  readonly createFinalHumanResult: typeof createFinalHumanResult;
  readonly createFailureHumanMessage: typeof createFailureHumanMessage;
  readonly plannerCompletion: Pick<IntentPlannerCompletionHelpers, "actionFromPlanner" | "failState" | "failWithVisibleHumanError" | "appendObservation" | "sendPlannerRequest" | "askHuman" | "notifyHuman" | "awaitInput" | "startToolRun" | "completeState" | "reopenDurableThread" | "createFinalHumanResult" | "createFailureHumanMessage">;
  readonly plannerReentry: Pick<IntentPlannerReentryHelpers, "appendEvent" | "appendObservation" | "sendPlannerRequest" | "clone" | "sanitizeJson">;
  readonly plannerStartContinue: Pick<IntentPlannerStartContinueHelpers, "failState" | "failWithVisibleHumanError" | "appendEvent" | "appendObservation" | "sendPlannerRequest">;
  readonly activeToolRunActorId: typeof activeToolRunActorId;
  readonly completeToolRunResult: (state: IntentToolRunState, result: JsonValue) => JsonValue;
  readonly toolCatalogById: typeof toolCatalogById;
}

function createIntentSubsystemSupport(args: BuildIntentSubsystemArgs): IntentSubsystemSupport {
  const { registry, ActorKind } = args;
  return {
    registry,
    ActorKind,
    IntentToolRunKind,
    clone,
    sanitizeJson,
    intentError,
    selectedModels,
    appendEvent,
    appendObservation,
    notifyRouterCard: notifyRouterCardForIntent,
    sendPlannerRequest,
    actionFromPlanner,
    askHuman,
    notifyHuman,
    awaitInput,
    startToolRun,
    completeState,
    failState,
    failWithVisibleHumanError,
    reopenDurableThread,
    createFinalHumanResult,
    createFailureHumanMessage,
    plannerCompletion: {
      actionFromPlanner,
      failState,
      appendObservation,
      sendPlannerRequest,
      askHuman,
      notifyHuman,
      awaitInput,
      startToolRun,
      completeState,
      reopenDurableThread,
      createFinalHumanResult,
      createFailureHumanMessage,
      failWithVisibleHumanError,
    },
    plannerReentry: {
      appendEvent,
      appendObservation,
      sendPlannerRequest,
      clone,
      sanitizeJson,
    },
    plannerStartContinue: {
      failState,
      appendEvent,
      appendObservation,
      sendPlannerRequest,
      failWithVisibleHumanError,
    },
    activeToolRunActorId,
    completeToolRunResult: (state, result) => completeToolRunResult(toolCatalogById, state, result, sanitizeJson),
    toolCatalogById,
  };
}

export function buildIntentSubsystemBundle(args: BuildIntentSubsystemArgs) {
  return {
    definitions: buildIntentSubsystemDefinitions(args),
    presentations: {},
  } as const;
}

export function buildIntentSubsystemDefinitions(args: BuildIntentSubsystemArgs) {
  const { registry, ActorKind } = args;
  const support = createIntentSubsystemSupport(args);

  return {
    [ActorKind.Intents]: new IntentsRouterActor(support).buildDefinition(),
    [ActorKind.Intent]: new IntentActor(support).buildDefinition(),
    [IntentToolRunKind]: new IntentToolRunActor(support).buildDefinition(),
  } as unknown as Pick<ActorDefinitionMap<typeof registry>, typeof ActorKind.Intents | typeof ActorKind.Intent | typeof IntentToolRunKind>;
}

export function buildIntentSubsystemPresentations(_args: BuildIntentSubsystemArgs): ActorTreePresentationMap<AvenRegistry> {
  return {};
}
