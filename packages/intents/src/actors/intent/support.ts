import type { ActorContext, JsonValue } from "typed-actors";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import { cloneJsonValue } from "shared";
import type {
  IntentObservation,
  IntentRoutingCard,
  IntentStatus,
  IntentTimelineEvent,
} from "../../domain.ts";
import type { IntentActorState } from "./types.ts";

const MAX_OBSERVATION_BYTES = 8_192;

export type IntentErrorCategory =
  | "intentMissing"
  | "invalidRequest"
  | "staleHumanReply"
  | "configuration"
  | "plannerInvalid"
  | "toolRejected"
  | "toolInvalidInput";

export function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

export function normalizeState<T>(value: T): T {
  return cloneJsonValue(value);
}

export function bounded(value: JsonValue): JsonValue {
  const text = JSON.stringify(value);
  if (text.length <= MAX_OBSERVATION_BYTES) {
    return clone(value);
  }
  return { preview: text.slice(0, MAX_OBSERVATION_BYTES), truncated: true } as JsonValue;
}

export function sanitizeJson(value: JsonValue): JsonValue {
  const visit = (entry: JsonValue): JsonValue => {
    if (typeof entry === "string") {
      if (entry.includes("data:image/") || /[A-Za-z0-9+/]{120,}={0,2}/u.test(entry)) {
        return "[redacted]";
      }
      return entry;
    }
    if (Array.isArray(entry)) {
      return entry.slice(0, 20).map((item) => visit(item as JsonValue)) as JsonValue;
    }
    if (entry && typeof entry === "object") {
      const source = entry as Record<string, JsonValue>;
      const result: Record<string, JsonValue> = {};
      for (const [key, raw] of Object.entries(source)) {
        if (raw === undefined) {
          continue;
        }
        if (["bytesBase64", "base64", "rawBytes", "dataUrl", "schema"].includes(key)) {
          const serialized = JSON.stringify(raw);
          result[key] = { redacted: true, size: serialized.length } as JsonValue;
          continue;
        }
        result[key] = visit(raw);
      }
      return result as JsonValue;
    }
    return entry;
  };
  return bounded(visit(value));
}

export function intentError(category: IntentErrorCategory, message: string, details?: JsonValue): JsonValue {
  return {
    type: "error",
    error: {
      category,
      message,
      ...(details === undefined ? {} : { details: sanitizeJson(details) }),
    },
  } as JsonValue;
}

export function okResult(data: Record<string, JsonValue | undefined>): JsonValue {
  return { type: "ok", ...data } as JsonValue;
}

function nextEventId(state: IntentActorState): string {
  return `event~${state.timeline.length + 1}`;
}

export function appendEvent(
  state: IntentActorState,
  nowIso: string,
  type: IntentTimelineEvent["type"],
  summary: string,
  data?: JsonValue,
): IntentActorState {
  return {
    ...state,
    timeline: [
      ...state.timeline,
      {
        eventId: nextEventId(state),
        type,
        createdAt: nowIso,
        summary,
        ...(data === undefined ? {} : { data: sanitizeJson(data) }),
      },
    ],
  };
}

export function appendObservation(
  state: IntentActorState,
  at: string,
  type: IntentObservation["type"],
  summary: string,
  data?: JsonValue,
): IntentActorState {
  return {
    ...state,
    observations: [
      ...state.observations,
      {
        at,
        type,
        summary,
        ...(data === undefined ? {} : { data: sanitizeJson(data) }),
      },
    ],
  };
}

function routingSummaryForState(state: IntentActorState): string {
  switch (state.status as IntentStatus) {
    case "created":
      return "Intent created";
    case "running":
      return "Intent running";
    case "waitingForTool":
      return "Waiting for tool result";
    case "waitingForHuman":
      return "Waiting for human input";
    case "waitingForExternalInput":
      return "Waiting for more input";
    case "completed":
      return state.humanAnswers.length > 0 ? "Intent completed after human answer" : "Intent completed";
    case "failed":
      return "Intent failed";
    case "cancelled":
      return "Intent cancelled";
  }
}

export function routingCardFromIntent(state: IntentActorState, updatedAt: string): IntentRoutingCard {
  return {
    intentId: state.intentId,
    status: state.status,
    durable: state.durable,
    title: state.title,
    routingSummary: routingSummaryForState(state),
    ...(state.durable === true
      && state.externalInputRequest !== undefined
      && state.status !== "completed"
      && state.status !== "failed"
      && state.status !== "cancelled"
      ? {
          acceptsExternalInput: {
            enabled: true,
            title: state.externalInputRequest.title,
            body: state.externalInputRequest.body,
            routingDescription: state.externalInputRequest.routingDescription,
          },
        }
      : {}),
    ...(state.openQuestionId ? { openQuestionId: state.openQuestionId, openQuestionSummary: "Awaiting human answer" } : {}),
    ...(state.openCommunicationId ? { openCommunicationId: state.openCommunicationId } : {}),
    ...(state.activeToolRunId ? { activeToolRunId: state.activeToolRunId } : {}),
    routingVersion: state.timeline.length,
    updatedAt,
  };
}

export function notifyRouterCard(
  ctx: ActorContext<AvenRegistry, "intent">,
  state: IntentActorState,
  messageFactory: (routingCard: IntentRoutingCard) => unknown,
): void {
  if (!ctx.parent) {
    return;
  }
  const updatedAt = state.timeline.at(-1)?.createdAt ?? ctx.now.toISOString();
  ctx.send(ctx.parent, messageFactory(routingCardFromIntent(state, updatedAt)) as never);
}
