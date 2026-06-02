import type { ActorContext, JsonValue } from "typed-actors";
import type { AvenRegistry } from "../../../../runtime/src/spine.ts";
import type { AvailableLlmDescriptor, LlmCapabilityRequirements, LlmRequest, LlmResult, LlmUsageMeter } from "llm-contracts";
import type { ProviderRuntime } from "../../runtime-support.ts";
import { buildAvailableLlmDescriptor, createLlmsInitialState, discoverProviderModels, mergeProviderModels, modelDescriptorById, reconcileModels } from "../../runtime-support.ts";
import { normalizeLlmModelCapabilities } from "../../domain.ts";
import { providerListModelsResult } from "../../results.ts";
import type { LlmsMessage, LlmsState, LlmProviderMessage, LlmProviderState } from "./types.ts";
import { clone } from "../../support.ts";

function effectiveRequirements(request: LlmRequest): LlmCapabilityRequirements | undefined {
  if (!request.responseSchema) {
    return request.requirements;
  }
  const requiredGeneral = new Set(request.requirements?.general?.requires ?? []);
  requiredGeneral.add("structuredOutput");
  return {
    ...(request.requirements?.input === undefined ? {} : { input: request.requirements.input }),
    ...(request.requirements?.output === undefined ? {} : { output: request.requirements.output }),
    general: { requires: [...requiredGeneral] },
  } satisfies LlmCapabilityRequirements;
}

function matchesRequirements(descriptor: AvailableLlmDescriptor, requirements: LlmCapabilityRequirements | undefined): boolean {
  if (!requirements) return descriptor.availability === "available";
  const requiredInputs = requirements.input?.modalities ?? [];
  const requiredOutputs = requirements.output?.modalities ?? [];
  const requiredGeneral = requirements.general?.requires ?? [];
  const supportsInputModality = (modality: string): boolean => {
    if (modality === "text") return descriptor.capabilities.input.text;
    if (modality === "json") return descriptor.capabilities.input.json === true || descriptor.capabilities.input.text;
    return descriptor.capabilities.input.artifacts.some((artifact) => artifact.kind === modality);
  };
  return descriptor.availability === "available"
    && requiredInputs.every((modality) => supportsInputModality(modality))
    && requiredOutputs.every((modality) => descriptor.capabilities.output.modalities.includes(modality))
    && requiredGeneral.every((capability) => descriptor.capabilities.general.capabilities.includes(capability));
}

function estimateTokens(result: LlmResult): { readonly inputTokens: number; readonly outputTokens: number } {
  if (result.type !== "ok" || !result.usage || typeof result.usage !== "object" || Array.isArray(result.usage)) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  const usage = result.usage as Record<string, unknown>;
  const rawUsage = typeof usage.usage === "object" && usage.usage !== null && !Array.isArray(usage.usage)
    ? usage.usage as Record<string, unknown>
    : usage;
  const inputTokens = typeof rawUsage.prompt_tokens === "number"
    ? rawUsage.prompt_tokens
    : typeof rawUsage.input_tokens === "number"
      ? rawUsage.input_tokens
      : 0;
  const outputTokens = typeof rawUsage.completion_tokens === "number"
    ? rawUsage.completion_tokens
    : typeof rawUsage.output_tokens === "number"
      ? rawUsage.output_tokens
      : 0;
  return { inputTokens, outputTokens };
}

function estimatedCostUsd(pricing: AvailableLlmDescriptor["pricing"], inputTokens: number, outputTokens: number): number {
  if (!pricing) return 0;
  return ((pricing.inputUsdPerMillionTokens ?? 0) * inputTokens + (pricing.outputUsdPerMillionTokens ?? 0) * outputTokens) / 1_000_000;
}

function selectedDescriptor(catalog: readonly AvailableLlmDescriptor[], request: LlmRequest): AvailableLlmDescriptor | undefined {
  const requirements = effectiveRequirements(request);
  if (request.preferredModelActorPath) {
    return catalog.find((descriptor) => {
      return descriptor.modelActorPath === request.preferredModelActorPath
        && matchesRequirements(descriptor, requirements);
    });
  }
  return catalog.find((descriptor) => matchesRequirements(descriptor, requirements));
}

export function createLlmProviderHelpers(args: {
  readonly registry: AvenRegistry;
  readonly ActorKind: typeof import("../../../../runtime/src/spine.ts").ActorKind;
  readonly llmConfig: ReturnType<typeof import("../../runtime-support.ts").resolveEffectiveConfig>;
  readonly providerRuntimes: Record<string, ProviderRuntime>;
  readonly llmRetention?: import("./types.ts").BuildLlmSubsystemOptions["llmRetention"];
}) {
  const { registry, ActorKind, llmConfig, providerRuntimes, llmRetention } = args;

  const providerHelpers = {
    spawnConfiguredProviders: (ctx: ActorContext<typeof registry, typeof ActorKind.Llms>) => {
      for (const provider of llmConfig.providers) {
        const runtime = providerRuntimes[provider.id];
        ctx.spawn(ActorKind.LlmProvider, {
          id: ctx.self.id.child(provider.id),
          init: {
            providerId: provider.id,
            title: provider.title,
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            auth: provider.auth,
            ...(provider.discovery === undefined ? {} : { discovery: provider.discovery }),
            modelDefaults: {
              capabilities: normalizeLlmModelCapabilities(provider.modelDefaults?.capabilities),
              ...(provider.modelDefaults?.pricing === undefined ? {} : { pricing: provider.modelDefaults.pricing }),
            },
            modelIds: [],
            modelSlugsById: {},
            modelsById: modelDescriptorById(provider),
            defaults: {
              maxParallel: llmConfig.defaults?.maxParallel ?? 1,
              maxQueue: llmConfig.defaults?.maxQueue ?? 2,
              ...(llmConfig.defaults?.maxOutputTokens === undefined ? {} : { maxOutputTokens: llmConfig.defaults.maxOutputTokens }),
              ...(llmConfig.defaults?.retentionMaxCompleted === undefined ? {} : { retentionMaxCompleted: llmConfig.defaults.retentionMaxCompleted }),
              ...(llmConfig.defaults?.retentionMaxInlineResultBytes === undefined ? {} : { retentionMaxInlineResultBytes: llmConfig.defaults.retentionMaxInlineResultBytes }),
            },
          } satisfies LlmProviderState,
        });
      }
    },
    reconcileModelsOnStart: async (ctx: ActorContext<typeof registry, typeof ActorKind.LlmProvider>) => {
      const configuredProvider = llmConfig.providers.find((provider) => provider.id === ctx.state.providerId);
      const runtime = providerRuntimes[ctx.state.providerId];
      const discovered = configuredProvider?.discovery?.enabled ? await discoverProviderModels(runtime) : [];
      const mergedModels = configuredProvider
        ? mergeProviderModels({ provider: configuredProvider, discoveredModels: discovered })
        : ctx.state.modelsById;
      const nextModelIds = Object.keys(mergedModels).sort();
      const preparedState = { ...ctx.state, modelsById: mergedModels };
      ctx.setState(clone(preparedState));
      const nextState = reconcileModels(ctx, ActorKind, preparedState, nextModelIds, llmRetention);
      ctx.setState(clone(nextState));
      const rootActorId = ctx.self.id.parent();
      if (rootActorId) {
        ctx.send(
          { id: rootActorId, kind: ActorKind.Llms as never },
          {
            type: "replaceProviderCatalog",
            providerId: nextState.providerId,
            descriptors: nextState.modelIds.map((modelId) => ({
              ...buildAvailableLlmDescriptor(nextState, modelId, nextState.modelsById[modelId]),
              modelActorPath: ctx.self.id.child(`model~${nextState.modelSlugsById[modelId]}`).toString(),
            })),
          } satisfies Extract<LlmsMessage, { readonly type: "replaceProviderCatalog" }> as never,
        );
      }
    },
    withListModelsOperationResult: (state: LlmProviderState) => state,
    handleListModelsMessage: (
      ctx: ActorContext<typeof registry, typeof ActorKind.LlmProvider>,
      message: LlmProviderMessage,
    ) => {
      if (message.type !== "listModels") {
        return false;
      }
      ctx.setState(clone(providerHelpers.withListModelsOperationResult(ctx.state)));
      return true;
    },
  };

  const rootHelpers = {
    createDefaultState: () => createLlmsInitialState(),
    withCatalogOperationResult: (state: LlmsState, requirements?: LlmCapabilityRequirements) => ({
      ...state,
    }),
    withUsageOperationResult: (state: LlmsState, callerActorId?: string) => ({
      ...state,
    }),
    registerAvailableLlm: (state: LlmsState, descriptor: AvailableLlmDescriptor): LlmsState => ({
      ...state,
      catalog: [...state.catalog.filter((entry) => entry.modelActorPath !== descriptor.modelActorPath || entry.source?.configId !== descriptor.source?.configId), descriptor]
        .sort((a, b) => `${a.providerId}/${a.modelId}/${a.source?.configId ?? "default"}`.localeCompare(`${b.providerId}/${b.modelId}/${b.source?.configId ?? "default"}`)),
    }),
    replaceProviderCatalog: (state: LlmsState, providerId: string, descriptors: readonly AvailableLlmDescriptor[]): LlmsState => ({
      ...state,
      catalog: [...state.catalog.filter((entry) => entry.providerId !== providerId), ...descriptors]
        .sort((a, b) => `${a.providerId}/${a.modelId}/${a.source?.configId ?? "default"}`.localeCompare(`${b.providerId}/${b.modelId}/${b.source?.configId ?? "default"}`)),
    }),
    handleGatewayRequest: (ctx: ActorContext<typeof registry, typeof ActorKind.Llms>, state: LlmsState, message: LlmRequest): LlmsState => {
      const descriptor = selectedDescriptor(state.catalog, message);
      const requestId = message.requestId ?? `gateway~${Date.now()}`;
      if (!descriptor) {
        const result: LlmResult = {
          type: "error",
          requestId,
          error: {
            category: "invalidRequest",
            code: "LLM_NO_COMPATIBLE_MODEL",
            message: "No compatible LLM model is available for the requested capabilities.",
            details: { requirements: effectiveRequirements(message) ?? null } as JsonValue,
          },
        };
        if (message.replyTo) {
          ctx.send({ id: message.replyTo.actorId as never, kind: message.replyTo.actorKind as never }, { type: "llmRequestCompleted", requestId, result } as never);
        }
        return state;
      }
      const configId = descriptor.source?.configId ?? "default";
      ctx.send(
        { id: descriptor.modelActorPath as never, kind: ActorKind.LlmModel as never },
        {
          type: "submitLlmRequest",
          requestId,
          input: clone(message.input),
          ...(message.responseSchema === undefined ? {} : { responseSchema: clone(message.responseSchema) }),
          ...(message.maxOutputTokens === undefined ? {} : { maxOutputTokens: message.maxOutputTokens }),
          ...(message.thinking === undefined ? {} : { thinking: message.thinking }),
          replyTo: { actorId: ctx.self.id.toString(), actorKind: ActorKind.Llms },
        } satisfies Extract<LlmsMessage, { readonly type: "submitLlmRequest" }> as never,
      );
      return {
        ...state,
        pendingRequests: {
          ...state.pendingRequests,
          [requestId]: {
            requestId,
            callerActorId: message.callerActorId ?? ctx.self.id.toString(),
            selectedModelActorPath: descriptor.modelActorPath,
            selectedConfigId: configId,
            pricing: descriptor.pricing,
            replyTo: message.replyTo,
            startedAt: ctx.now.toISOString(),
          },
        },
      };
    },
    handleGatewayCompletion: (ctx: ActorContext<typeof registry, typeof ActorKind.Llms>, state: LlmsState, message: Extract<LlmsMessage, { readonly type: "llmRequestCompleted" }>): LlmsState => {
      const pending = state.pendingRequests[message.requestId];
      if (!pending) {
        return state;
      }
      const { inputTokens, outputTokens } = estimateTokens(message.result);
      const currentUsage = state.usageByCallerActorId[pending.callerActorId] ?? {
        callerActorId: pending.callerActorId,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      } satisfies LlmUsageMeter;
      const nextUsage: LlmUsageMeter = {
        ...currentUsage,
        requestCount: currentUsage.requestCount + 1,
        inputTokens: currentUsage.inputTokens + inputTokens,
        outputTokens: currentUsage.outputTokens + outputTokens,
        estimatedCostUsd: currentUsage.estimatedCostUsd + estimatedCostUsd(pending.pricing, inputTokens, outputTokens),
        lastRequestAt: ctx.now.toISOString(),
      };
      if (pending.replyTo) {
        ctx.send({ id: pending.replyTo.actorId as never, kind: pending.replyTo.actorKind as never }, message as never);
      }
      const nextPendingRequests = { ...state.pendingRequests };
      delete nextPendingRequests[message.requestId];
      return {
        ...state,
        pendingRequests: nextPendingRequests,
        usageByCallerActorId: {
          ...state.usageByCallerActorId,
          [pending.callerActorId]: nextUsage,
        },
      };
    },
    handleRootMessage: (ctx: ActorContext<typeof registry, typeof ActorKind.Llms>, message: LlmsMessage): boolean => {
      if (message.type === "registerAvailableLlm") {
        ctx.setState(clone(rootHelpers.registerAvailableLlm(ctx.state as LlmsState, message.descriptor)));
        return true;
      }
      if (message.type === "replaceProviderCatalog") {
        ctx.setState(clone(rootHelpers.replaceProviderCatalog(ctx.state as LlmsState, message.providerId, message.descriptors)));
        return true;
      }
      if (message.type === "listAvailableLlms") {
        ctx.setState(clone(rootHelpers.withCatalogOperationResult(ctx.state as LlmsState, message.requirements)));
        return true;
      }
      if (message.type === "findLlmsByCapabilities") {
        ctx.setState(clone(rootHelpers.withCatalogOperationResult(ctx.state as LlmsState, message.requirements)));
        return true;
      }
      if (message.type === "getLlmUsage") {
        ctx.setState(clone(rootHelpers.withUsageOperationResult(ctx.state as LlmsState, message.callerActorId)));
        return true;
      }
      if (message.type === "llmRequestCompleted") {
        ctx.setState(clone(rootHelpers.handleGatewayCompletion(ctx, ctx.state as LlmsState, message)));
        return true;
      }
      if (message.type === "submitLlmRequest") {
        ctx.setState(clone(rootHelpers.handleGatewayRequest(ctx, ctx.state as LlmsState, message)));
        return true;
      }
      return false;
    },
  };

  return {
    rootHelpers,
    providerHelpers,
    rootPresent: () => ({
      title: "llms",
      subtitle: `${llmConfig.providers.length} configured providers`,
    }),
  };
}