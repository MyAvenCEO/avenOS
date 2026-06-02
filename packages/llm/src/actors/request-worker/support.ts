import { ActorId, StopReasonType, type ActorContext, type JsonValue } from "typed-actors";
import type { LlmRequestCompleted, LlmResult } from "llm-contracts";
import type { ValidateJsonRequest } from "schema-contracts";
import type { SchemaValidationResult, SchemaRef } from "schema/domain";
import { toReplyAddress } from "shared";
import { clone, classifiedError, toLlmResultError } from "../../support.ts";
import type {
  LlmRequestWorkerAwaiting,
  LlmRequestWorkerState,
} from "../llms/types.ts";

interface RequestCompletedMessage {
  readonly type: "requestCompleted";
  readonly requestId: string;
  readonly result: LlmResult;
}

export function mapClientError(requestId: string, error: unknown): LlmResult {
  if (error instanceof Error && 'code' in error && error.name === 'LlmHttpClientError') {
    const clientError = error as Error & { code: string; details?: JsonValue };
    return { type: "error", requestId, error: classifiedError("providerError", `LLM_PROVIDER_${clientError.code}`, clientError.message, clientError.details) };
  }
  return { type: "error", requestId, error: classifiedError("providerError", "LLM_PROVIDER_UNKNOWN", error instanceof Error ? error.message : "Unknown provider error.") };
}

export function sendValidationRequest(ctx: ActorContext<any, any>, requestId: string, schemaRef: SchemaRef, value: JsonValue): void {
  const request: ValidateJsonRequest = {
    type: "validateJsonRequest",
    requestId,
    schemaRef: clone(schemaRef),
    value: clone(value),
    replyTo: toReplyAddress(ctx.self.id, "llmRequestWorker"),
  };
  ctx.send({ id: ActorId.parse("/aven/system/schemas"), kind: "schemaRegistry" as never }, request as never);
}

export function workerComplete(ctx: ActorContext<any, any>, result: LlmResult): void {
  const nextState: LlmRequestWorkerState = {
    ...(ctx.state as LlmRequestWorkerState),
    status: "completed",
    result: clone(result),
  };
  delete (nextState as { awaiting?: LlmRequestWorkerAwaiting }).awaiting;
  ctx.setState(nextState);
  if (ctx.parent) {
    ctx.send(
      ctx.parent,
      { type: "requestCompleted", requestId: result.requestId, result: clone(result) } satisfies RequestCompletedMessage as never,
    );
  }
  if (nextState.request.replyTo) {
    ctx.send(
      { id: ActorId.parse(nextState.request.replyTo.actorId), kind: nextState.request.replyTo.actorKind as never },
      { type: "llmRequestCompleted", requestId: result.requestId, result: clone(result) } satisfies LlmRequestCompleted as never,
    );
  }
  ctx.stop({ type: StopReasonType.Completed });
}

export function validateCompletedToResult(
  requestId: string,
  validation: SchemaValidationResult,
  candidateValue?: JsonValue,
): LlmResult {
  if (validation.type === "ok") {
    return { type: "ok", requestId, output: [{ kind: "json", value: null }], usage: { validated: true } };
  }
  const details = validation.error.details && typeof validation.error.details === "object" && !Array.isArray(validation.error.details)
    ? clone(validation.error.details as JsonValue)
    : validation.error.details;
  const enrichedDetails = candidateValue === undefined
    ? details
    : {
        ...(details && typeof details === "object" && !Array.isArray(details) ? details as Record<string, JsonValue> : { validationDetails: details as JsonValue | undefined }),
        candidateValue: clone(candidateValue),
      } as JsonValue;
  return toLlmResultError(
    requestId,
    classifiedError(
      validation.error.category === "schemaNotFound" ? "schemaNotFound" : "schemaInvalid",
      validation.error.code,
      validation.error.message,
      enrichedDetails as JsonValue | undefined,
    ),
  );
}
