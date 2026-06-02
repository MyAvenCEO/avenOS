import { buildActorRuntime, defineActorShape, field, msg, op, type DerivedActorRuntime, type JsonValue } from "typed-actors";
import type { HumanCommunication, HumanStartedIntentRecord } from "human-contracts";
import type { HumanActorMessage, HumanActorState, PendingHumanAnswerValidation } from "./types.ts";

const schemaRefSchema = {
  type: "object",
  required: ["schemaId", "version"],
  additionalProperties: false,
  properties: {
    schemaId: { type: "string" },
    version: { type: "string" },
  },
} as const;

const optionSchema = {
  type: "object",
  required: ["optionId", "label"],
  additionalProperties: false,
  properties: {
    optionId: { type: "string" },
    label: { type: "string" },
    value: {},
    dangerous: { type: "boolean" },
  },
} as const;

const routingHintSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intentId: { type: "string" },
    openQuestionId: { type: "string" },
    approvalId: { type: "string" },
    routerClarificationId: { type: "string" },
  },
} as const;

const createCommunicationDefault = {
  kind: "requestInput",
  title: "Need invoice number",
  body: "Please provide the invoice number.",
  context: { source: "manual debug" },
  schemaRef: { schemaId: "note", version: "1.0.0" },
} as const;

/** Declarative human actor shape for guard/init/result-helper derivation. */
export const humanActorShape = defineActorShape({
  kind: "human",
  state: {
    communicationsById: field.ref<Readonly<Record<string, HumanCommunication>>>({ default: {} as Readonly<Record<string, HumanCommunication>> }),
    openCommunicationIds: field.ref<readonly string[]>({ default: [] }),
    completedCommunicationIds: field.ref<readonly string[]>({ default: [] }),
    startedIntents: field.ref<readonly HumanStartedIntentRecord[]>({ default: [] }),
    nextCommunicationNumber: field.integer({ default: 1 }),
    pendingAnswerValidationsByRequestId: field.ref<Readonly<Record<string, PendingHumanAnswerValidation>>>({ optional: true }),
  },
  messages: {
    createCommunication: msg({
      communicationId: field.string({ optional: true }),
      kind: field.string(),
      title: field.string(),
      body: field.string(),
      context: field.json({ optional: true }),
      schemaRef: field.schema(schemaRefSchema, { optional: true }),
      options: field.schema({ type: "array", items: optionSchema }, { optional: true }),
      suggestedOptionId: field.string({ optional: true }),
      routingHint: field.schema(routingHintSchema, { optional: true }),
      createdBy: field.string({ optional: true }),
    }),
    answerCommunication: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>({ optional: true }),
      communicationId: field.string(),
      answer: field.json(),
    }),
    dismissCommunication: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>({ optional: true }),
      communicationId: field.string(),
    }),
    getCommunication: msg({
      communicationId: field.string(),
    }),
    listOpenCommunications: msg({}),
    listCompletedCommunications: msg({}),
    recordStartedIntent: msg({
      requestId: field.string({ optional: true }),
      replyTo: field.ref<{ readonly actorId: string; readonly actorKind: string }>({ optional: true }),
      intentId: field.string(),
      decision: field.string(),
      message: field.string(),
      attachmentRefs: field.json(),
    }),
    schemaValidationCompleted: msg({
      requestId: field.string(),
      result: field.json(),
    }),
  },
  operations: {
    createCommunication: op({
      title: "Create communication",
      description: "Create a new human-facing communication.",
      mutates: true,
      input: {
        communicationId: field.string({ optional: true }),
        kind: field.string({ description: "requestInput | requestApproval | showProgress | showResult | showWarning | showError | showBlocked" }),
        title: field.string(),
        body: field.string(),
        context: field.json({ optional: true }),
        schemaRef: field.schema(schemaRefSchema, { optional: true }),
        options: field.schema({ type: "array", items: optionSchema }, { optional: true }),
        suggestedOptionId: field.string({ optional: true }),
        routingHint: field.schema(routingHintSchema, { optional: true }),
        createdBy: field.string({ optional: true }),
      },
      defaultValue: createCommunicationDefault,
    }),
    answerCommunication: op({
      title: "Answer communication",
      description: "Answer an open human communication.",
      mutates: true,
      input: {
        communicationId: field.string({ default: "comm~1" }),
        answer: field.json({ default: { text: "INV-001" } }),
      },
    }),
    dismissCommunication: op({
      title: "Dismiss communication",
      description: "Dismiss an open human communication.",
      mutates: true,
      input: {
        communicationId: field.string({ default: "comm~1" }),
      },
    }),
    getCommunication: op({
      title: "Get communication",
      description: "Load a human communication by id.",
      input: {
        communicationId: field.string({ default: "comm~1" }),
      },
    }),
    listOpenCommunications: op({
      title: "List open communications",
      description: "List all open human communications.",
    }),
    listCompletedCommunications: op({
      title: "List completed communications",
      description: "List all answered and dismissed communications.",
    }),
  },
  present(state) {
    return {
      title: "human",
      subtitle: `${state.openCommunicationIds.length} open / ${state.completedCommunicationIds.length} completed`,
    };
  },
});

/** Composed runtime for the human actor. */
export const humanActorRuntime = buildActorRuntime(humanActorShape) as DerivedActorRuntime<
  typeof humanActorShape.messages,
  HumanActorState
>;

export function isHumanShapeMessage(value: unknown): value is HumanActorMessage {
  return humanActorRuntime.isMessage(value);
}