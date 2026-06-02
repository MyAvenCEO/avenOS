import type { JsonValue } from "typed-actors";
import type { LlmOutputPart } from "llm-contracts";
import type { IntentExternalInputRequest, IntentRoutingCard, ParseResult } from "../../domain.ts";

export interface RouterPromptAttachment {
  readonly filename?: string;
  readonly effectiveMimeType?: string;
  readonly mediaRole?: string;
  readonly artifactId?: string;
}

export interface IntentRouteDecision {
  readonly decision: "routeToIntent" | "createNew" | "askHuman";
  readonly intentId: string;
  readonly candidateIntentIds: readonly string[];
  readonly clarificationQuestion: string;
  readonly reason: string;
}

function isRecord(value: JsonValue | undefined | null): value is Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

export function buildExternalInputRequest(args: {
  readonly title: string;
  readonly body: string;
  readonly stateTitle: string;
  readonly stateGoal: string;
  readonly createdAt: string;
}): IntentExternalInputRequest {
  return {
    title: args.title,
    body: args.body,
    createdAt: args.createdAt,
    routingDescription: [
      `Intent title: ${args.stateTitle}`,
      `Intent goal: ${args.stateGoal}`,
      `Currently waiting: ${args.title}`,
      args.body,
    ].join("\n"),
  };
}

export function buildRouterSystemPrompt(): string {
  return [
    "You are the semantic router for long-running intent threads.",
    "You decide whether a new global human message should be delivered to one existing durable intent, should start a new intent, or requires asking the human where it belongs.",
    "Messages and filenames may be in any language. Interpret them semantically. Do not rely on shared words or language-specific token overlap.",
    "Use the candidate routing cards as descriptions of what each durable intent is waiting for.",
    "Attachments are important evidence. A filename, MIME type, or mediaRole can indicate what the artifact is, but do not assume an attachment belongs to a candidate unless the candidate's purpose makes that plausible.",
    "Return routeToIntent only when one candidate is clearly the right owner.",
    "Return createNew when the message is unrelated to all candidates.",
    "Return askHuman when multiple candidates are plausible or when one candidate is plausible but not clear enough.",
    "You may only select intent ids that appear in the candidates.",
  ].join(" ");
}

export function buildRouterUserPrompt(args: {
  readonly message: string;
  readonly attachments: readonly RouterPromptAttachment[];
  readonly candidates: readonly IntentRoutingCard[];
}): string {
  return JSON.stringify({
    message: args.message,
    attachments: args.attachments.map((attachment) => ({
      ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
      ...(attachment.effectiveMimeType === undefined ? {} : { effectiveMimeType: attachment.effectiveMimeType }),
      ...(attachment.mediaRole === undefined ? {} : { mediaRole: attachment.mediaRole }),
      ...(attachment.artifactId === undefined ? {} : { artifactId: attachment.artifactId }),
    })),
    candidates: args.candidates.map((candidate) => ({
      intentId: candidate.intentId,
      title: candidate.title,
      routingSummary: candidate.routingSummary,
      acceptsExternalInput: candidate.acceptsExternalInput
        ? {
            title: candidate.acceptsExternalInput.title,
            body: candidate.acceptsExternalInput.body,
            routingDescription: candidate.acceptsExternalInput.routingDescription,
          }
        : undefined,
    })),
  }, null, 2);
}

function parseDecisionRecord(value: JsonValue): ParseResult<IntentRouteDecision> {
  if (!isRecord(value)) {
    return { type: "error", message: "Route decision must be an object." };
  }
  const decision = value.decision;
  const intentId = value.intentId;
  const candidateIntentIds = value.candidateIntentIds;
  const clarificationQuestion = value.clarificationQuestion;
  const reason = value.reason;
  if (decision !== "routeToIntent" && decision !== "createNew" && decision !== "askHuman") {
    return { type: "error", message: "Route decision contains an invalid decision field.", details: value };
  }
  if (typeof intentId !== "string") {
    return { type: "error", message: "Route decision intentId must be a string.", details: value };
  }
  if (!Array.isArray(candidateIntentIds) || candidateIntentIds.some((entry) => typeof entry !== "string")) {
    return { type: "error", message: "Route decision candidateIntentIds must be an array of strings.", details: value };
  }
  if (typeof clarificationQuestion !== "string") {
    return { type: "error", message: "Route decision clarificationQuestion must be a string.", details: value };
  }
  if (typeof reason !== "string") {
    return { type: "error", message: "Route decision reason must be a string.", details: value };
  }
  return {
    type: "ok",
    value: {
      decision,
      intentId,
      candidateIntentIds,
      clarificationQuestion,
      reason,
    },
  };
}

export function parseRouteDecisionFromLlmOutput(output: readonly LlmOutputPart[]): ParseResult<IntentRouteDecision> {
  for (const part of output) {
    if (part.kind === "json") {
      return parseDecisionRecord(part.value);
    }
    if (part.kind === "text") {
      try {
        return parseDecisionRecord(JSON.parse(part.text) as JsonValue);
      } catch {
        continue;
      }
    }
  }
  return { type: "error", message: "Router LLM response did not contain a JSON route decision." };
}