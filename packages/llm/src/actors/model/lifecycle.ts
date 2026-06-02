import { ActorId, type ActorContext, type JsonObject, type JsonValue } from "typed-actors";
import type { PendingAsyncResult } from "../../../../actor-contracts/src/index.ts";
import type { LlmRequestCompleted, LlmRequest, LlmResult } from "llm-contracts";
import type {
  CompletedLlmRequest,
  LlmRequestWorkerAwaiting,
  LlmModelState,
  RunningRequest,
} from "../llms/types.ts";
import { clone, classifiedError } from "../../support.ts";
import { toInlineJsonPreview } from "shared";

export function withBoundedOperationResult(state: LlmModelState, value: JsonValue): LlmModelState {
  return state;
}

export function pendingAsyncResult(requestId: string, awaiting: LlmRequestWorkerAwaiting): PendingAsyncResult<LlmRequestWorkerAwaiting> {
  return {
    type: "pending",
    requestId,
    awaiting,
  };
}

export function ensureRequest(message: LlmRequest, nextRequestNumber: number): Omit<LlmRequest, "requestId"> & { readonly requestId: string } {
  return { ...clone(message), thinking: message.thinking ?? "default", requestId: message.requestId ?? `request~${nextRequestNumber}` };
}

export function duplicateRequestResult(requestId: string): JsonValue {
  return { type: "error", requestId, error: classifiedError("invalidRequest", "LLM_REQUEST_ID_CONFLICT", `requestId '${requestId}' is already queued, running, or retained in completed history.`) } as unknown as JsonValue;
}

export function hasRequestIdConflict(state: LlmModelState, requestId: string): boolean {
  return state.queued.some((item) => item.requestId === requestId) || state.running[requestId] !== undefined || state.completedRecent[requestId] !== undefined;
}

export function retainCompletedRequest(state: LlmModelState, completed: CompletedLlmRequest): Pick<LlmModelState, "completedRecent" | "completedOrder" | "evictedCompletedCount"> {
  const completedRecent = { ...state.completedRecent, [completed.requestId]: completed };
  const completedOrder = [...state.completedOrder.filter((id) => id !== completed.requestId), completed.requestId];
  let evictedCompletedCount = state.evictedCompletedCount;
  while (completedOrder.length > state.retention.maxCompleted) {
    const evictedId = completedOrder.shift();
    if (evictedId) {
      delete completedRecent[evictedId];
      evictedCompletedCount += 1;
    }
  }
  return { completedRecent, completedOrder, evictedCompletedCount };
}

export function startRequest(
  ctx: ActorContext<any, any>,
  workerKind: string,
  state: LlmModelState,
  request: Omit<LlmRequest, "requestId"> & { readonly requestId: string },
): LlmModelState {
  const actorId = ctx.self.id.child(request.requestId);
  ctx.spawn(workerKind as never, {
    id: actorId,
    init: {
      providerId: state.providerId,
      providerTitle: state.providerTitle,
      providerProtocol: state.providerProtocol,
      providerBaseUrl: state.providerBaseUrl,
      modelId: state.modelId,
      configId: state.configId,
      capabilities: clone(state.capabilities),
      requestId: request.requestId,
      status: "running",
      awaiting: "providerResponse",
      request,
    },
  });
  ctx.send({ id: actorId, kind: workerKind as never }, { type: "beginProcessing" } as never);
  return {
    ...state,
    running: {
      ...state.running,
      [request.requestId]: {
        requestId: request.requestId,
        actorId: actorId.toString(),
        startedAt: ctx.now.toISOString(),
        request,
      } satisfies RunningRequest,
    },
  };
}

export function maybeStartQueued(ctx: ActorContext<any, any>, workerKind: string, state: LlmModelState): LlmModelState {
  let nextState = state;
  while (Object.keys(nextState.running).length < nextState.maxParallel && nextState.queued.length > 0) {
    const [nextQueued, ...rest] = nextState.queued;
    nextState = { ...nextState, queued: rest };
    nextState = startRequest(ctx, workerKind, nextState, nextQueued!.request);
  }
  return nextState;
}

export function sendImmediateCompletionIfRequested(
  ctx: ActorContext<any, any>,
  request: Omit<LlmRequest, "requestId"> & { readonly requestId: string },
  result: LlmResult,
): void {
  if (!request.replyTo) {
    return;
  }
  ctx.send(
    { id: ActorId.parse(request.replyTo.actorId), kind: request.replyTo.actorKind as never },
    { type: "llmRequestCompleted", requestId: request.requestId, result: clone(result) } satisfies LlmRequestCompleted as never,
  );
}

export function submitRequest(
  ctx: ActorContext<any, any>,
  workerKind: string,
  state: LlmModelState,
  message: LlmRequest,
  validateLlmInputAgainstCapabilities: (capabilities: LlmModelState["capabilities"], request: Pick<LlmRequest, "input" | "thinking">) => JsonValue,
): LlmModelState {
  const request = ensureRequest(message, state.nextRequestNumber);
  const nextRequestNumber = message.requestId ? state.nextRequestNumber : state.nextRequestNumber + 1;
  let nextState: LlmModelState = { ...state, nextRequestNumber };
  if (hasRequestIdConflict(nextState, request.requestId)) {
    const duplicate = duplicateRequestResult(request.requestId) as unknown as LlmResult;
    sendImmediateCompletionIfRequested(ctx, request, duplicate);
    return withBoundedOperationResult(nextState, duplicate as unknown as JsonValue);
  }
  const validation = validateLlmInputAgainstCapabilities(state.capabilities, request);
  if ((validation as { type?: string }).type === "error") {
    const errorResult = { ...(validation as JsonObject), requestId: request.requestId } as unknown as LlmResult;
    sendImmediateCompletionIfRequested(ctx, request, errorResult);
    return withBoundedOperationResult(nextState, errorResult as unknown as JsonValue);
  }
  if (Object.keys(nextState.running).length < nextState.maxParallel) {
    nextState = startRequest(ctx, workerKind, nextState, request);
    return withBoundedOperationResult(nextState, { type: "accepted", requestId: request.requestId, status: "running" } as JsonValue);
  }
  if (nextState.queued.length >= nextState.maxQueue) {
    const queueFull = { type: "error", requestId: request.requestId, error: classifiedError("queueFull", "LLM_QUEUE_FULL", `LLM queue is full (maxQueue=${nextState.maxQueue}).`, { maxQueue: nextState.maxQueue, runningCount: Object.keys(nextState.running).length }) } as LlmResult;
    sendImmediateCompletionIfRequested(ctx, request, queueFull);
    return withBoundedOperationResult(nextState, queueFull as unknown as JsonValue);
  }
  return withBoundedOperationResult(
    { ...nextState, queued: [...nextState.queued, { requestId: request.requestId, enqueuedAt: ctx.now.toISOString(), request }] },
    { type: "accepted", requestId: request.requestId, status: "queued" } as JsonValue,
  );
}

export function completeRequest(
  ctx: ActorContext<any, any>,
  workerKind: string,
  state: LlmModelState,
  message: { readonly requestId: string; readonly result: LlmResult },
): LlmModelState {
  const nextRunning = { ...state.running };
  delete nextRunning[message.requestId];
  const retained = retainCompletedRequest(state, { requestId: message.requestId, completedAt: ctx.now.toISOString(), result: clone(message.result) });
  let nextState: LlmModelState = {
    ...state,
    running: nextRunning,
    completedRecent: retained.completedRecent,
    completedOrder: retained.completedOrder,
    evictedCompletedCount: retained.evictedCompletedCount,
  };
  nextState = maybeStartQueued(ctx, workerKind, nextState);
  return withBoundedOperationResult(nextState, clone(message.result as unknown as JsonValue));
}