import { type JsonObject, type JsonValue } from "typed-actors";
import type {
  ClassifiedError,
  LlmMessage,
  LlmRequest,
  LlmResult,
} from "llm-contracts";
import { cloneJsonValue, jsonObjectEntries } from "../../shared/src/index.ts";

export function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

export function toJsonObject(value: Record<string, JsonValue | undefined>): JsonObject {
  return jsonObjectEntries(value);
}

export function classifiedError(category: ClassifiedError["category"], code: string, message: string, details?: JsonValue): ClassifiedError {
  return { category, code, message, ...(details === undefined ? {} : { details }) };
}

export function latestUserText(messages: readonly LlmMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    for (let j = message.content.length - 1; j >= 0; j -= 1) {
      const part = message.content[j]!;
      if (part.kind === "text") return part.text;
    }
  }
  return undefined;
}

export function requestSummary(request: Omit<LlmRequest, "requestId"> & { readonly requestId: string }): JsonValue {
  return toJsonObject({
    requestId: request.requestId,
    messageCount: request.input.messages.length,
    latestUserText: latestUserText(request.input.messages) ?? null,
    responseSchema: request.responseSchema ? clone(request.responseSchema as unknown as JsonValue) : undefined,
    maxOutputTokens: request.maxOutputTokens,
    thinking: request.thinking ?? "default",
  });
}

export function toLlmResultError(requestId: string, error: ClassifiedError): LlmResult {
  return { type: "error", requestId, error };
}
