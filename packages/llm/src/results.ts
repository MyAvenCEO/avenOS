import type { JsonValue } from "typed-actors";
import type {
  LlmsState,
  LlmModelState,
  LlmProviderState,
  LlmRequestWorkerState,
} from "./actors/llms/types.ts";
import { clone, requestSummary, toJsonObject } from "./support.ts";

export function requestAliasSummary(state: LlmRequestWorkerState): JsonValue {
  return toJsonObject({
    requestId: state.requestId,
    status: state.status,
    providerId: state.providerId,
    modelId: state.modelId,
    configId: state.configId,
    input: requestSummary(state.request),
    result: state.result as unknown as JsonValue | undefined,
  });
}

export function rootSummary(state: LlmsState): JsonValue {
  return {
    ready: state.ready,
    catalogSize: state.catalog.length,
    pendingGatewayRequests: Object.keys(state.pendingRequests).length,
    meteredCallers: Object.keys(state.usageByCallerActorId).length,
  } as JsonValue;
}

export function listRequestsResult(state: LlmModelState): JsonValue {
  return {
    type: "ok",
    queued: state.queued.map((item) => item.requestId),
    running: Object.keys(state.running).sort(),
    completed: [...state.completedOrder],
  } as JsonValue;
}

export function describeCapabilitiesResult(state: LlmModelState): JsonValue {
  return {
    type: "ok",
    providerId: state.providerId,
    modelId: state.modelId,
    configId: state.configId,
    capabilities: clone(state.capabilities as unknown as JsonValue),
  } as JsonValue;
}

export function buildModelExecutionSummary(state: LlmModelState): JsonValue {
  return {
    providerId: state.providerId,
    providerTitle: state.providerTitle,
    modelId: state.modelId,
    configId: state.configId,
    queueLength: state.queued.length,
    runningCount: Object.keys(state.running).length,
    completedRetainedCount: state.completedOrder.length,
    completedEvictedCount: state.evictedCompletedCount,
    capabilities: clone(state.capabilities as unknown as JsonValue),
    queuedRequestIds: state.queued.map((item) => item.requestId),
    runningRequestIds: Object.keys(state.running).sort(),
    completedRequestIds: [...state.completedOrder],
  } as JsonValue;
}

export function buildRequestsCollectionSummary(state: LlmModelState): JsonValue {
  return {
    activeRequestIds: Object.keys(state.running).sort(),
    completedRequestIds: [...state.completedOrder],
    completedRetainedCount: state.completedOrder.length,
    completedEvictedCount: state.evictedCompletedCount,
  } as JsonValue;
}

export function providerStateSummary(state: LlmProviderState): JsonValue {
  return toJsonObject({
    providerId: state.providerId,
    title: state.title,
    protocol: state.protocol,
    baseUrl: state.baseUrl,
    auth: { type: state.auth.type } as unknown as JsonValue,
    modelCount: state.modelIds.length,
    modelIds: state.modelIds as unknown as JsonValue,
  });
}

export function providerListModelsResult(state: LlmProviderState): JsonValue {
  return {
    type: "ok",
    providerId: state.providerId,
    baseUrl: state.baseUrl,
    models: state.modelIds.map((modelId) => ({
      modelId,
      configId: state.modelsById[modelId]?.configId ?? "default",
      actorPath: `/aven/system/llms/${state.providerId}/model~${state.modelSlugsById[modelId]}`,
    })),
  } as JsonValue;
}

export function modelSummary(state: LlmModelState): JsonValue {
  return toJsonObject({
    providerId: state.providerId,
    modelId: state.modelId,
    title: state.title,
    configId: state.configId,
    slug: state.slug,
    queueLength: state.queued.length,
    runningCount: Object.keys(state.running).length,
    completedRetainedCount: state.completedOrder.length,
    completedEvictedCount: state.evictedCompletedCount,
    capabilities: clone(state.capabilities as unknown as JsonValue),
    available: state.available,
    lastSeenAt: state.lastSeenAt,
  });
}

export function requestAliasNodeSummary(
  requestId: string,
  status: "running" | "completed",
  extra: { readonly input?: JsonValue; readonly result?: JsonValue },
): JsonValue {
  return toJsonObject({ requestId, status, input: extra.input, result: extra.result });
}
