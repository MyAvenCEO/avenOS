import {
  ActorId,
  buildActorDefinition,
  cloneJson,
  type ActorContext,
  type ActorDefinitionMap,
  type JsonValue,
} from "typed-actors";
import { ErrorCategory } from "actor-contracts";
import type { DebugMessageDescriptor, AvenRegistry } from "../../../../runtime/src/spine.ts";
import type {
  HumanCommunication,
  HumanCommunicationKind,
  HumanCommunicationStatus,
  HumanStartedIntentRecord,
} from "human-contracts";
import type { HumanReplyReceived } from "intents-contracts";
import type { ValidateJsonRequest } from "schema-contracts";
import { toReplyAddress } from "shared";
import { sendRequestResult } from "../../../../runtime/src/request-results.ts";
import type { HumanActorMessage, HumanActorState } from "./types.ts";
import { humanActorRuntime, humanActorShape } from "./shape.ts";
type HumanErrorCategory = "humanCommunicationMissing" | "invalidRequest" | "schemaInvalid" | "schemaNotFound";

function isNotificationCommunicationKind(kind: HumanCommunicationKind): boolean {
  return kind === "showProgress"
    || kind === "showResult"
    || kind === "showError"
    || kind === "showBlocked";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function humanError(category: HumanErrorCategory, message: string, details?: JsonValue): JsonValue {
  return {
    type: "error",
    error: {
      category,
      message,
      ...(details === undefined ? {} : { details }),
    },
  } as JsonValue;
}

function humanCommunicationSummary(communication: HumanCommunication): JsonValue {
  return {
    communicationId: communication.communicationId,
    kind: communication.kind,
    status: communication.status,
    title: communication.title,
    createdBy: communication.createdBy,
    createdAt: communication.createdAt,
  } as JsonValue;
}

function fullCommunicationToJson(communication: HumanCommunication): JsonValue {
  return cloneJson(communication as unknown as JsonValue);
}

function requireDebugDescriptor(id: string): DebugMessageDescriptor {
  const descriptor = humanActorRuntime.debugDescriptors.find((entry) => entry.id === id);
  if (!descriptor) {
    throw new Error(`Missing human debug descriptor '${id}'.`);
  }
  return descriptor as DebugMessageDescriptor;
}

export const humanDebugMessageDescriptors = [
  requireDebugDescriptor("human.createCommunication"),
  requireDebugDescriptor("human.answerCommunication"),
  requireDebugDescriptor("human.dismissCommunication"),
  requireDebugDescriptor("human.getCommunication"),
  requireDebugDescriptor("human.listOpenCommunications"),
  requireDebugDescriptor("human.listCompletedCommunications"),
] as const satisfies readonly DebugMessageDescriptor[];

function createCommunicationId(state: HumanActorState): string {
  return `comm~${state.nextCommunicationNumber}`;
}

function communicationById(state: HumanActorState, communicationId: string): HumanCommunication | undefined {
  return state.communicationsById[communicationId];
}

function completeCommunication(
  state: HumanActorState,
  communication: HumanCommunication,
  nextStatus: Extract<HumanCommunicationStatus, "delivered" | "answered" | "dismissed" | "expired">,
  nowIso: string,
  answer?: JsonValue,
): HumanActorState {
  const nextCommunication: HumanCommunication = {
    ...communication,
    status: nextStatus,
    ...((nextStatus === "answered" || nextStatus === "delivered") ? { answeredAt: nowIso, ...(answer === undefined ? {} : { answer: cloneJson((answer ?? null) as JsonValue) }) } : {}),
  };
  const nextOpen = state.openCommunicationIds.filter((id) => id !== communication.communicationId);
  const nextCompleted = [...state.completedCommunicationIds.filter((id) => id !== communication.communicationId), communication.communicationId];
  return {
    ...state,
    communicationsById: { ...state.communicationsById, [communication.communicationId]: nextCommunication },
    openCommunicationIds: nextOpen,
    completedCommunicationIds: nextCompleted,
  };
}

function listCommunicationsByIds(state: HumanActorState, ids: readonly string[]): readonly HumanCommunication[] {
  return ids
    .map((id) => state.communicationsById[id])
    .filter((entry): entry is HumanCommunication => entry !== undefined);
}

function listCommunicationsJson(state: HumanActorState, ids: readonly string[]): JsonValue {
  return listCommunicationsByIds(state, ids).map((communication) => fullCommunicationToJson(communication)) as unknown as JsonValue;
}

function routeAnsweredCommunicationToIntents(
  ctx: ActorContext<AvenRegistry, "human">,
  ActorKind: typeof import("../../../../runtime/src/spine.ts").ActorKind,
  communication: HumanCommunication,
  answer: JsonValue,
): void {
  if (communication.routingHint?.routerClarificationId) {
    ctx.send({ id: ActorId.parse("/aven/intents"), kind: ActorKind.Intents as never }, {
      type: "routeClarificationAnswered",
      communicationId: communication.communicationId,
      routerClarificationId: communication.routingHint.routerClarificationId,
      answer: cloneJson(answer),
    } as never);
    return;
  }
  if (!communication.routingHint?.intentId || !communication.routingHint?.openQuestionId) {
    return;
  }
  ctx.send({ id: ActorId.parse("/aven/intents"), kind: ActorKind.Intents as never }, {
    type: "humanReplyReceived",
    communicationId: communication.communicationId,
    answer: cloneJson(answer),
    routingHint: clone(communication.routingHint),
  } satisfies HumanReplyReceived as never);
}

function routeDismissedCommunicationToIntent(
  ctx: ActorContext<AvenRegistry, "human">,
  ActorKind: typeof import("../../../../runtime/src/spine.ts").ActorKind,
  communication: HumanCommunication,
): void {
  if (!communication.routingHint?.intentId) {
    return;
  }
  ctx.send({ id: ActorId.parse(`/aven/intents/${communication.routingHint.intentId}`), kind: ActorKind.Intent as never }, {
    type: "cancelIntent",
    reason: `Human dismissed communication '${communication.communicationId}'.`,
  } as never);
}

function answerValidationRequestId(communicationId: string): string {
  return `human-answer~${communicationId}`;
}

export function buildHumanSubsystemDefinitions(args: { readonly registry: AvenRegistry; readonly ActorKind: typeof import("../../../../runtime/src/spine.ts").ActorKind }) {
  const { registry, ActorKind } = args;

  return {
    [ActorKind.Human]: buildActorDefinition<typeof registry, typeof ActorKind.Human, typeof humanActorShape>(humanActorShape, {
      kind: ActorKind.Human,
      receive: {
        active(ctx, rawMessage) {
          const state = ctx.state as HumanActorState;
          const message = rawMessage as HumanActorMessage;

          if (message.type === "createCommunication") {
            const communicationId = message.communicationId ?? createCommunicationId(state);
            if (state.communicationsById[communicationId]) {
              return;
            }
            const delivered = isNotificationCommunicationKind(message.kind);
            const communication: HumanCommunication = {
              communicationId,
              kind: message.kind,
              status: delivered ? "delivered" : "open",
              title: message.title,
              body: message.body,
              ...(message.context === undefined ? {} : { context: cloneJson(message.context) }),
              ...(message.schemaRef === undefined ? {} : { schemaRef: clone(message.schemaRef) }),
              ...(message.options === undefined ? {} : { options: clone(message.options) }),
              ...(message.suggestedOptionId === undefined ? {} : { suggestedOptionId: message.suggestedOptionId }),
              ...(message.routingHint === undefined ? {} : { routingHint: clone(message.routingHint) }),
              createdBy: message.createdBy ?? ctx.self.id.toString(),
              createdAt: ctx.now.toISOString(),
              ...(delivered ? { answeredAt: ctx.now.toISOString() } : {}),
            };
            ctx.setState({
              ...state,
              communicationsById: { ...state.communicationsById, [communicationId]: communication },
              openCommunicationIds: delivered ? state.openCommunicationIds : [...state.openCommunicationIds, communicationId],
              completedCommunicationIds: delivered ? [...state.completedCommunicationIds, communicationId] : state.completedCommunicationIds,
              nextCommunicationNumber: message.communicationId ? state.nextCommunicationNumber : state.nextCommunicationNumber + 1,
            });
            return;
          }

          if (message.type === "getCommunication") {
            return;
          }

          if (message.type === "listOpenCommunications") {
            return;
          }

          if (message.type === "listCompletedCommunications") {
            return;
          }

          if (message.type === "recordStartedIntent") {
            const record: HumanStartedIntentRecord = {
              intentId: message.intentId,
              decision: message.decision,
              message: message.message,
              attachmentRefs: clone(message.attachmentRefs),
              createdAt: ctx.now.toISOString(),
            };
            if (message.requestId && message.replyTo) {
              sendRequestResult(ctx, message.replyTo, message.requestId, {
                type: "ok",
                value: { startedIntent: cloneJson(record as unknown as JsonValue) } as JsonValue,
              });
            }
            ctx.setState({
              ...state,
              startedIntents: [...state.startedIntents, record],
            });
            return;
          }

          if (message.type === "dismissCommunication") {
            const communication = communicationById(state, message.communicationId);
            if (!communication) {
              if (message.requestId && message.replyTo) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.NotFound,
                    code: "HUMAN_COMMUNICATION_MISSING",
                    message: `Communication '${message.communicationId}' was not found.`,
                  },
                });
              }
              return;
            }
            if (communication.status !== "open") {
              if (message.requestId && message.replyTo) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.InvalidRequest,
                    code: "HUMAN_COMMUNICATION_NOT_OPEN",
                    message: `Communication '${message.communicationId}' is not open.`,
                  },
                });
              }
              return;
            }
            const nextState = completeCommunication(state, communication, "dismissed", ctx.now.toISOString());
            routeDismissedCommunicationToIntent(ctx as ActorContext<AvenRegistry, "human">, ActorKind, communication);
            if (message.requestId && message.replyTo) {
              sendRequestResult(ctx, message.replyTo, message.requestId, {
                type: "ok",
                value: { communication: fullCommunicationToJson(nextState.communicationsById[message.communicationId]!) } as JsonValue,
              });
            }
            ctx.setState(nextState);
            return;
          }

          if (message.type === "answerCommunication") {
            const communication = communicationById(state, message.communicationId);
            if (!communication) {
              if (message.requestId && message.replyTo) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.NotFound,
                    code: "HUMAN_COMMUNICATION_MISSING",
                    message: `Communication '${message.communicationId}' was not found.`,
                  },
                });
              }
              return;
            }
            if (communication.status !== "open") {
              if (message.requestId && message.replyTo) {
                sendRequestResult(ctx, message.replyTo, message.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.InvalidRequest,
                    code: "HUMAN_COMMUNICATION_NOT_OPEN",
                    message: `Communication '${message.communicationId}' is not open.`,
                  },
                });
              }
              return;
            }
            if (communication.schemaRef) {
              const requestId = answerValidationRequestId(message.communicationId);
              const validationRequest: ValidateJsonRequest = {
                type: "validateJsonRequest",
                requestId,
                schemaRef: clone(communication.schemaRef),
                value: cloneJson(message.answer),
                replyTo: toReplyAddress(ctx.self.id, ActorKind.Human),
              };
              ctx.send({ id: ActorId.parse("/aven/system/schemas"), kind: ActorKind.SchemaRegistry as never }, validationRequest as never);
              ctx.setState({
                ...state,
                pendingAnswerValidationsByRequestId: {
                  ...(state.pendingAnswerValidationsByRequestId ?? {}),
                  [requestId]: {
                    requestId,
                    replyTo: message.replyTo,
                    communicationId: message.communicationId,
                    answer: cloneJson(message.answer),
                  },
                },
              });
              return;
            }
            const nextState = completeCommunication(state, communication, "answered", ctx.now.toISOString(), message.answer);
            routeAnsweredCommunicationToIntents(ctx as ActorContext<AvenRegistry, "human">, ActorKind, communication, message.answer);
            if (message.requestId && message.replyTo) {
              sendRequestResult(ctx, message.replyTo, message.requestId, {
                type: "ok",
                value: { communication: fullCommunicationToJson(nextState.communicationsById[message.communicationId]!) } as JsonValue,
              });
            }
            ctx.setState(nextState);
            return;
          }

          if (message.type === "schemaValidationCompleted") {
            const pending = state.pendingAnswerValidationsByRequestId?.[message.requestId];
            if (!pending) {
              return;
            }
            const nextPending = { ...(state.pendingAnswerValidationsByRequestId ?? {}) };
            delete nextPending[message.requestId];
            if (message.result.type === "error") {
              if (pending.replyTo) {
                sendRequestResult(ctx, pending.replyTo, pending.requestId, {
                  type: "error",
                  error: {
                    category: message.result.error.category === "schemaNotFound" ? ErrorCategory.NotFound : ErrorCategory.InvalidRequest,
                    code: message.result.error.category === "schemaNotFound" ? "HUMAN_ANSWER_SCHEMA_NOT_FOUND" : "HUMAN_ANSWER_SCHEMA_INVALID",
                    message: message.result.error.message,
                    details: cloneJson((message.result.error.details ?? null) as JsonValue),
                  },
                });
              }
              ctx.setState({
                ...state,
                pendingAnswerValidationsByRequestId: nextPending,
              });
              return;
            }
            const communication = communicationById(state, pending.communicationId);
            if (!communication || communication.status !== "open") {
              if (pending.replyTo) {
                sendRequestResult(ctx, pending.replyTo, pending.requestId, {
                  type: "error",
                  error: {
                    category: ErrorCategory.InvalidRequest,
                    code: "HUMAN_COMMUNICATION_NOT_OPEN",
                    message: `Communication '${pending.communicationId}' is not open.`,
                  },
                });
              }
              ctx.setState({
                ...state,
                pendingAnswerValidationsByRequestId: nextPending,
              });
              return;
            }
            const completedState = completeCommunication(
              { ...state, pendingAnswerValidationsByRequestId: nextPending },
              communication,
              "answered",
              ctx.now.toISOString(),
              pending.answer,
            );
            routeAnsweredCommunicationToIntents(ctx as ActorContext<AvenRegistry, "human">, ActorKind, communication, pending.answer);
            if (pending.replyTo) {
              sendRequestResult(ctx, pending.replyTo, pending.requestId, {
                type: "ok",
                value: { communication: fullCommunicationToJson(completedState.communicationsById[pending.communicationId]!) } as JsonValue,
              });
            }
            ctx.setState(completedState);
          }
        },
      },

    }),
  } satisfies Pick<ActorDefinitionMap<typeof registry>, typeof ActorKind.Human>;
}


export function buildHumanSubsystemBundle(args: { readonly registry: AvenRegistry; readonly ActorKind: typeof import("../../../../runtime/src/spine.ts").ActorKind }) {
  return {
    definitions: buildHumanSubsystemDefinitions(args),
    presentations: {},
  } as const;
}
