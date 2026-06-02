import { createHash } from "node:crypto";
import type { ActorContext, JsonValue } from "typed-actors";
import type { AvailableLlmDescriptor, ConfiguredLlmModel, ConfiguredLlmProvider, LlmModelCapabilities, LlmPricing, LlmProviderProtocol, LlmProvidersConfig } from "llm-contracts";
import type { AvenRegistry } from "../../runtime/src/spine.ts";
import { createLlmHttpClient, type LlmHttpClient } from "./client.ts";
import { defaultLlmModelCapabilities, normalizeLlmModelCapabilities } from "./domain.ts";
import { loadLlmProvidersConfig } from "./provider-config.ts";
import { clone, classifiedError } from "./support.ts";
import type {
  BuildLlmSubsystemOptions,
  LlmRequestRetentionPolicy,
  LlmsState,
  LlmModelState,
  LlmProviderState,
  RefreshModelConfigMessage,
} from "./actors/llms/types.ts";

export interface ProviderRuntime {
  readonly client?: LlmHttpClient;
  readonly authError?: ReturnType<typeof classifiedError>;
}

function createProviderClient(provider: ConfiguredLlmProvider, timeoutMs: number, authHeader?: string): LlmHttpClient {
  switch (provider.protocol) {
    case "openai.chat-completions":
    case "openai.responses":
    case "openai-compatible.chat-completions":
      return createLlmHttpClient({ baseUrl: provider.baseUrl, timeoutMs, ...(authHeader === undefined ? {} : { authHeader }) });
  }
}

export interface DiscoveredProviderModel {
  readonly modelId: string;
  readonly title?: string;
}

export function createLlmsInitialState(): LlmsState {
  return {
    ready: true,
    catalog: [],
    usageByCallerActorId: {},
    pendingRequests: {},
  };
}

export function toModelSlug(modelId: string): string {
  return createHash("sha256").update(modelId).digest("base64url").slice(0, 12);
}

function modelRetention(input: {
  readonly retention?: Partial<LlmRequestRetentionPolicy>;
  readonly retentionMaxCompleted?: number;
  readonly retentionMaxInlineResultBytes?: number;
}): LlmRequestRetentionPolicy {
  return {
    maxCompleted: input.retentionMaxCompleted ?? input.retention?.maxCompleted ?? 10,
    maxInlineResultBytes: input.retentionMaxInlineResultBytes ?? input.retention?.maxInlineResultBytes ?? 2048,
  };
}

function mergedModelCapabilities(provider: ConfiguredLlmProvider, configured: ConfiguredLlmModel | undefined): LlmModelCapabilities {
  return normalizeLlmModelCapabilities(configured?.capabilities ?? provider.modelDefaults?.capabilities ?? defaultLlmModelCapabilities);
}

function configuredModelTitle(modelId: string, configured: ConfiguredLlmModel | undefined): string {
  return configured?.title ?? modelId;
}

function mergedModelPricing(provider: ConfiguredLlmProvider, configured: ConfiguredLlmModel | undefined): LlmPricing | undefined {
  return configured?.pricing ?? provider.modelDefaults?.pricing;
}

function configuredConfigId(configured: ConfiguredLlmModel | undefined): string {
  return configured?.configId ?? "default";
}

function providerSnapshot(state: LlmProviderState): ConfiguredLlmProvider {
  return {
    id: state.providerId,
    title: state.title,
    protocol: state.protocol,
    baseUrl: state.baseUrl,
    auth: state.auth,
    ...(state.discovery === undefined ? {} : { discovery: state.discovery }),
    modelDefaults: state.modelDefaults,
    models: Object.values(state.modelsById),
  } satisfies ConfiguredLlmProvider;
}

export function buildAvailableLlmDescriptor(
  providerState: LlmProviderState,
  modelId: string,
  configured: ConfiguredLlmModel | undefined,
): AvailableLlmDescriptor {
  const provider = providerSnapshot(providerState);
  const slug = providerState.modelSlugsById[modelId] ?? toModelSlug(modelId);
  const configId = configuredConfigId(configured);
  return {
    providerId: providerState.providerId,
    modelId,
    title: configuredModelTitle(modelId, configured),
    modelActorPath: `${providerState.providerId}/model~${slug}`,
    capabilities: mergedModelCapabilities(provider, configured),
    ...(mergedModelPricing(provider, configured) === undefined ? {} : { pricing: mergedModelPricing(provider, configured) }),
    availability: "available",
    source: {
      discovery: providerState.modelsById[modelId]?.title ? "merged" : "configured",
      configId,
    },
  } satisfies AvailableLlmDescriptor;
}

export function buildRefreshModelConfigMessage(
  providerState: LlmProviderState,
  modelId: string,
  configured: ConfiguredLlmModel | undefined,
  nowIso: string,
): RefreshModelConfigMessage {
  const provider = providerSnapshot(providerState);
  return {
    type: "refreshModelConfig",
    providerTitle: providerState.title,
    providerProtocol: providerState.protocol,
    providerBaseUrl: providerState.baseUrl,
    configId: configuredConfigId(configured),
    title: configuredModelTitle(modelId, configured),
    capabilities: mergedModelCapabilities(provider, configured),
    ...(mergedModelPricing(provider, configured) === undefined ? {} : { pricing: mergedModelPricing(provider, configured) }),
    maxParallel: providerState.defaults.maxParallel,
    maxQueue: providerState.defaults.maxQueue,
    ...(providerState.defaults.maxOutputTokens === undefined ? {} : { defaultMaxOutputTokens: providerState.defaults.maxOutputTokens }),
    available: true,
    lastSeenAt: nowIso,
  } satisfies RefreshModelConfigMessage;
}

function toProviderAuthError(provider: ConfiguredLlmProvider, envName: string) {
  return classifiedError("providerError", "LLM_AUTH_ENV_MISSING", `Provider '${provider.id}' requires environment variable '${envName}' for bearer auth.`, { providerId: provider.id, env: envName });
}

export function resolveProviderRuntime(
  provider: ConfiguredLlmProvider,
  defaults: LlmProvidersConfig["defaults"],
  options?: BuildLlmSubsystemOptions,
): ProviderRuntime {
  const injected = options?.llmClientsByProviderId?.[provider.id];
  if (injected) return { client: injected };
  const timeoutMs = defaults?.requestTimeoutMs ?? 10_000;
  if (provider.auth.type === "bearer") {
    return { client: createProviderClient(provider, timeoutMs, `Bearer ${provider.auth.token}`) };
  }
  if (provider.auth.type === "bearerEnv") {
    const secret = process.env[provider.auth.env];
    if (!secret) return { authError: toProviderAuthError(provider, provider.auth.env) };
    return { client: createProviderClient(provider, timeoutMs, `Bearer ${secret}`) };
  }
  return { client: createProviderClient(provider, timeoutMs) };
}

export function modelDescriptorById(provider: ConfiguredLlmProvider): Record<string, ConfiguredLlmModel> {
  return Object.fromEntries((provider.models ?? []).map((model) => [model.modelId, clone(model)]));
}

export function spawnModelActor(
  ctx: ActorContext<any, any>,
  ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind,
  providerState: LlmProviderState,
  modelId: string,
  configured: ConfiguredLlmModel | undefined,
  llmRetention?: Partial<LlmRequestRetentionPolicy>,
): void {
  const slug = providerState.modelSlugsById[modelId] ?? toModelSlug(modelId);
  const descriptor = buildAvailableLlmDescriptor(providerState, modelId, configured);
  const configId = descriptor.source?.configId ?? "default";
  const refreshMessage = buildRefreshModelConfigMessage(providerState, modelId, configured, ctx.now.toISOString());
  ctx.spawn(ActorKind.LlmModel, {
    id: ctx.self.id.child(`model~${slug}`),
    init: {
      providerId: providerState.providerId,
      providerTitle: refreshMessage.providerTitle,
      providerProtocol: refreshMessage.providerProtocol,
      providerBaseUrl: refreshMessage.providerBaseUrl,
      modelId,
      configId: refreshMessage.configId,
      title: refreshMessage.title,
      slug,
      capabilities: refreshMessage.capabilities,
      ...(refreshMessage.pricing === undefined ? {} : { pricing: refreshMessage.pricing }),
      maxParallel: refreshMessage.maxParallel,
      maxQueue: refreshMessage.maxQueue,
      ...(refreshMessage.defaultMaxOutputTokens === undefined ? {} : { defaultMaxOutputTokens: refreshMessage.defaultMaxOutputTokens }),
      retention: modelRetention({
        retention: llmRetention ?? optionsRetention(providerState),
        retentionMaxCompleted: providerState.defaults.retentionMaxCompleted,
        retentionMaxInlineResultBytes: providerState.defaults.retentionMaxInlineResultBytes,
      }),
      nextRequestNumber: 1,
      queued: [],
      running: {},
      completedRecent: {},
      completedOrder: [],
      evictedCompletedCount: 0,
      available: refreshMessage.available,
      lastSeenAt: refreshMessage.lastSeenAt,
    } satisfies LlmModelState,
  });
  const rootActorId = ctx.self.id.parent();
  if (!rootActorId) {
    return;
  }
  ctx.send(
    { id: rootActorId, kind: ActorKind.Llms as never },
    {
      type: "registerAvailableLlm",
      descriptor: {
        ...descriptor,
        modelActorPath: ctx.self.id.child(`model~${slug}`).toString(),
        source: { ...(descriptor.source ?? {}), configId },
      } satisfies AvailableLlmDescriptor,
    } as never,
  );
}

export async function discoverProviderModels(runtime: ProviderRuntime | undefined): Promise<readonly DiscoveredProviderModel[]> {
  if (!runtime?.client) {
    return [];
  }
  const discovered = await runtime.client.listModels();
  return discovered.map((model) => ({ modelId: model.id, title: model.id }));
}

export function mergeProviderModels(args: {
  readonly provider: ConfiguredLlmProvider;
  readonly discoveredModels: readonly DiscoveredProviderModel[];
}): Readonly<Record<string, ConfiguredLlmModel>> {
  const configuredById = modelDescriptorById(args.provider);
  const discoveredById = Object.fromEntries(args.discoveredModels.map((model) => [model.modelId, model]));
  const allowlistIds = args.provider.models && args.provider.models.length > 0
    ? args.provider.models.map((model) => model.modelId)
    : args.provider.discovery?.enabled
      ? args.discoveredModels.map((model) => model.modelId)
      : Object.keys(configuredById);
  return Object.fromEntries(allowlistIds.map((modelId) => {
    const configured = configuredById[modelId];
    const discovered = discoveredById[modelId];
    return [modelId, {
      modelId,
      ...(configured?.configId === undefined ? {} : { configId: configured.configId }),
      ...(configured?.title ?? discovered?.title ? { title: configured?.title ?? discovered?.title } : {}),
      ...(configured?.capabilities === undefined ? {} : { capabilities: configured.capabilities }),
      ...(configured?.pricing === undefined ? {} : { pricing: configured.pricing }),
    } satisfies ConfiguredLlmModel];
  }));
}

export function reconcileModels(
  ctx: ActorContext<any, any>,
  ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind,
  state: LlmProviderState,
  modelIds: readonly string[],
  llmRetention?: Partial<LlmRequestRetentionPolicy>,
): LlmProviderState {
  const nextSlugsById = { ...state.modelSlugsById };
  for (const modelId of modelIds) {
    const slug = nextSlugsById[modelId] ?? toModelSlug(modelId);
    nextSlugsById[modelId] = slug;
    if (!state.modelIds.includes(modelId)) {
      spawnModelActor(ctx, ActorKind, { ...state, modelSlugsById: nextSlugsById }, modelId, state.modelsById[modelId], llmRetention);
      continue;
    }
    ctx.send(
      { id: ctx.self.id.child(`model~${slug}`), kind: ActorKind.LlmModel as never },
      buildRefreshModelConfigMessage({ ...state, modelSlugsById: nextSlugsById }, modelId, state.modelsById[modelId], ctx.now.toISOString()) as never,
    );
  }
  return { ...state, modelIds: [...modelIds].sort(), modelSlugsById: nextSlugsById };
}

export function resolveEffectiveConfig(options?: BuildLlmSubsystemOptions): LlmProvidersConfig {
  if (options?.llmConfig) return options.llmConfig;
  return loadLlmProvidersConfig().config;
}

export function prepareLlmSubsystemRuntime(args: {
  readonly options?: BuildLlmSubsystemOptions;
}) {
  const { options } = args;
  const llmConfig = resolveEffectiveConfig(options);
  const injectedClients = options?.llmClientsByProviderId ?? {};
  const artifactStorage = options?.artifactStorage;
  const runtimeOptions = { ...options, llmClientsByProviderId: injectedClients };
  const providerRuntimes = Object.fromEntries(
    llmConfig.providers.map((provider) => [provider.id, resolveProviderRuntime(provider, llmConfig.defaults, runtimeOptions)]),
  ) as Record<string, ProviderRuntime>;
  const llmRetention = options?.llmRetention;
  return {
    llmConfig,
    artifactStorage,
    providerRuntimes,
    llmRetention,
  };
}

function optionsRetention(providerState: LlmProviderState): Partial<LlmRequestRetentionPolicy> | undefined {
  return {
    ...(providerState.defaults.retentionMaxCompleted === undefined ? {} : { maxCompleted: providerState.defaults.retentionMaxCompleted }),
    ...(providerState.defaults.retentionMaxInlineResultBytes === undefined ? {} : { maxInlineResultBytes: providerState.defaults.retentionMaxInlineResultBytes }),
  };
}
