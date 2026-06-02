import { buildActorRuntime, collection, defineActorShape, field, msg, op, type DerivedActorRuntime, type JsonValue } from "typed-actors";
import type { LlmCapabilityRequirements } from "llm-contracts";
import type { IntentRuntimeConfig } from "intents-contracts";
import type {
  IntentNextAction,
  IntentObservation,
  IntentRoutingCard,
  IntentSelectedModels,
  IntentStatus,
  IntentTimelineEvent,
} from "../../domain.ts";
import type { IntentActorState, IntentToolRunState, IntentsRouterState } from "../intent/types.ts";

const llmCapabilityRequirementsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        modalities: { type: "array", items: { type: "string" } },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      properties: {
        modalities: { type: "array", items: { type: "string" } },
      },
    },
    general: {
      type: "object",
      additionalProperties: false,
      properties: {
        requires: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

const toolDefaultsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    structuredExtraction: {
      type: "object",
      additionalProperties: false,
      properties: {
        requirements: llmCapabilityRequirementsSchema,
        modelActorPathOverride: { type: "string" },
      },
    },
  },
} as const;

const intentRuntimeConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    planner: {
      type: "object",
      additionalProperties: false,
      properties: {
        requirements: llmCapabilityRequirementsSchema,
        modelActorPathOverride: { type: "string" },
      },
    },
    toolDefaults: toolDefaultsSchema,
  },
} as const;

const humanReplyRoutingHintSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intentId: { type: "string" },
    openQuestionId: { type: "string" },
    approvalId: { type: "string" },
  },
} as const;

const createIntentInputSchema = {
  type: "object",
  required: ["goal"],
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    goal: { type: "string" },
    input: {},
    plannerRequirements: llmCapabilityRequirementsSchema,
    plannerModelActorPathOverride: { type: "string" },
    toolDefaults: toolDefaultsSchema,
  },
  default: {
    goal: "Process invoice screenshot",
    plannerRequirements: { input: { modalities: ["text"] }, output: { modalities: ["text"] } },
  },
} as const;

/** Minimal router shape used to unlock `buildActorDefinition(...)` adoption with custom init/guard overrides. */
export const intentsRouterShape = defineActorShape({
  kind: "intents",
  state: {
    nextIntentNumber: field.integer({ default: 1 }),
    nextRouteClarificationNumber: field.integer({ default: 1 }),
    nextSemanticRouteRequestNumber: field.integer({ default: 1 }),
    intentIds: field.ref<IntentsRouterState["intentIds"]>({ default: [] as IntentsRouterState["intentIds"] }),
    routingCardsByIntentId: field.ref<Record<string, IntentRoutingCard>>({ default: {} as Record<string, IntentRoutingCard> }),
    pendingRouteClarificationsById: field.ref<IntentsRouterState["pendingRouteClarificationsById"]>({ default: {} as IntentsRouterState["pendingRouteClarificationsById"] }),
    pendingSemanticRouteRequestsById: field.ref<IntentsRouterState["pendingSemanticRouteRequestsById"]>({ default: {} as IntentsRouterState["pendingSemanticRouteRequestsById"] }),
    configuration: field.ref<{ readonly runtime?: IntentRuntimeConfig }>({ default: {} as { readonly runtime?: IntentRuntimeConfig } }),
  },
  messages: {
    createIntent: msg({
      requestId: field.string({ optional: true }),
      title: field.string({ optional: true }),
      goal: field.string(),
      input: field.json({ optional: true }),
      plannerRequirements: field.ref<LlmCapabilityRequirements>({ optional: true }),
      plannerModelActorPathOverride: field.string({ optional: true }),
      toolDefaults: field.schema(toolDefaultsSchema, { optional: true }),
    }),
    configureIntentRuntime: msg({
      runtimeConfig: field.schema(intentRuntimeConfigSchema),
    }),
    listIntents: msg({}),
    getRoutingCard: msg({
      intentId: field.string(),
    }),
    humanReplyReceived: msg({
      communicationId: field.string(),
      answer: field.json(),
      routingHint: field.schema(humanReplyRoutingHintSchema),
    }),
    intentRoutingCardUpdated: msg({
      routingCard: field.ref<IntentRoutingCard>(),
    }),
  },
  operations: {
    createIntent: op({
      title: "Create intent",
      description: "Create a curated tool-using intent.",
      mutates: true,
      input: {
        title: field.string({ optional: true }),
        goal: field.string({ default: "Process invoice screenshot" }),
        input: field.json({ optional: true }),
        plannerRequirements: field.ref<LlmCapabilityRequirements>({ optional: true }),
        plannerModelActorPathOverride: field.string({ optional: true }),
        toolDefaults: field.schema(toolDefaultsSchema, { optional: true }),
      },
      defaultValue: createIntentInputSchema.default,
    }),
    configureIntentRuntime: op({
      title: "Configure intent runtime",
      description: "Configure planner and tool llm defaults.",
      mutates: true,
      input: {
        runtimeConfig: field.schema(intentRuntimeConfigSchema, {
          default: {
            planner: {
              requirements: { input: { modalities: ["text"] }, output: { modalities: ["text"] } },
            },
            toolDefaults: {
              structuredExtraction: {
                requirements: {
                  input: { modalities: ["text", "image"] },
                  output: { modalities: ["text", "json"] },
                  general: { requires: ["structuredOutput"] },
                },
              },
            },
          },
        }),
      },
    }),
    listIntents: op({
      title: "List intents",
    }),
    getRoutingCard: op({
      title: "Get routing card",
      input: {
        intentId: field.string({ default: "intent~1" }),
      },
    }),
  },
  tree: {
    describeSelf({ state, operations }) {
      return {
        hasChildren: state.intentIds.length > 0,
        childCount: state.intentIds.length,
        operations,
        summary: {
          intentCount: state.intentIds.length,
        },
      };
    },
  },
  present(state) {
    return { title: "intents", subtitle: `${state.intentIds.length} intents` };
  },
});

/** Minimal intent-actor shape used to unlock `buildActorDefinition(...)` adoption with custom init. */
export const intentActorShape = defineActorShape({
  kind: "intent",
  state: {
    intentId: field.string(),
    title: field.string(),
    goal: field.string(),
    input: field.json({ optional: true }),
    status: field.ref<IntentStatus>(),
    timeline: field.ref<readonly IntentTimelineEvent[]>({ default: [] as readonly IntentTimelineEvent[] }),
    observations: field.ref<readonly IntentObservation[]>({ default: [] as readonly IntentObservation[] }),
    openQuestionId: field.string({ optional: true }),
    openCommunicationId: field.string({ optional: true }),
    humanAnswers: field.ref<readonly JsonValue[]>({ default: [] as readonly JsonValue[] }),
    selectedModels: field.ref<IntentSelectedModels>(),
    currentStep: field.integer({ default: 0 }),
    toolRuns: field.integer({ default: 0 }),
    activeToolRunId: field.string({ optional: true }),
    activePlannerRequestId: field.string({ optional: true }),
  },
  messages: {
    startIntent: msg({}),
    getIntent: msg({}),
    continueIntent: msg({}),
    humanReply: msg({
      communicationId: field.string(),
      answer: field.json(),
      openQuestionId: field.string(),
    }),
    cancelIntent: msg({
      reason: field.string({ optional: true }),
    }),
    plannerCompleted: msg({
      requestId: field.string(),
      result: field.ref<IntentNextAction | Record<string, unknown>>(),
    }),
    llmRequestCompleted: msg({
      requestId: field.string(),
      result: field.ref<IntentNextAction | Record<string, unknown>>(),
    }),
    toolRunCompleted: msg({
      runId: field.string(),
      result: field.json(),
    }),
  },
  operations: {
    getIntent: op({
      title: "Get intent",
    }),
    continueIntent: op({
      title: "Continue intent",
      mutates: true,
    }),
    cancelIntent: op({
      title: "Cancel intent",
      mutates: true,
      input: {
        reason: field.string({ optional: true, default: "Cancelled by operator" }),
      },
    }),
  },
  tree: {
    describeSelf({ state, operations }) {
      return {
        hasChildren: true,
        childCount: 2,
        operations,
        summary: {
          intentId: state.intentId,
          status: state.status,
          plannerRequirements: state.selectedModels?.plannerRequirements,
          toolDefaults: state.selectedModels?.toolDefaults,
          currentStep: state.currentStep,
          toolRuns: state.toolRuns,
          ...(state.selectedModels?.plannerModelActorPathOverride === undefined
            ? {}
            : { plannerModelActorPathOverride: state.selectedModels.plannerModelActorPathOverride }),
        },
      };
    },
    children: [
      collection("timeline", {
        title: "timeline",
        hasChildren: ({ state }) => state.timeline.length > 0,
        childCount: ({ state }) => state.timeline.length,
        listItems: ({ state }) => state.timeline.map((event: IntentTimelineEvent) => ({
          path: `timeline/${event.eventId}`,
          nodeType: "virtualItem",
          title: event.eventId,
          hasChildren: false,
          status: event.type,
          summary: event as unknown as JsonValue,
        })),
      }),
      collection("jobs", {
        title: "jobs",
        hasChildren: ({ state }) => Boolean(state.activeToolRunId),
        childCount: ({ state }) => state.activeToolRunId ? 1 : 0,
        listItems: ({ state, selfId }) => state.activeToolRunId
          ? [{
              path: `jobs/${state.activeToolRunId}`,
              nodeType: "realActorAlias",
              title: state.activeToolRunId,
              actorId: `${selfId}/${state.activeToolRunId}`,
              actorKind: "intentToolRun",
              hasChildren: false,
              status: "running",
            }]
          : [],
      }),
    ],
  },
  present(state) {
    return { title: state.intentId, subtitle: `${state.status}: ${state.title}` };
  },
});

/** Minimal tool-run shape used to unlock `buildActorDefinition(...)` adoption with custom init. */
export const intentToolRunShape = defineActorShape({
  kind: "intentToolRun",
  state: {
    runId: field.string(),
    toolId: field.string(),
    input: field.json(),
    parentIntentId: field.string(),
    structuredExtractionRequirements: field.ref<LlmCapabilityRequirements>({ optional: true }),
    structuredExtractionModelActorPathOverride: field.string({ optional: true }),
    status: field.ref<IntentToolRunState["status"]>(),
    result: field.json({ optional: true }),
  },
  tree: {
    describeSelf({ state }) {
      return {
        hasChildren: false,
        childCount: 0,
        summary: state,
      };
    },
  },
  present(state) {
    return { title: state.runId, subtitle: state.toolId };
  },
});

export const intentsRouterRuntime = buildActorRuntime(intentsRouterShape) as DerivedActorRuntime<
  typeof intentsRouterShape.messages,
  IntentsRouterState
>;

export const intentActorRuntime = buildActorRuntime(intentActorShape) as DerivedActorRuntime<
  typeof intentActorShape.messages,
  IntentActorState
>;