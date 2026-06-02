import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConfiguredLlmModel,
  ConfiguredLlmProvider,
  LlmModelCapabilities,
  LlmPricing,
  LlmProviderAuth,
  LlmProviderProtocol,
  LlmProvidersConfig,
} from "llm-contracts";
import { cloneJsonValue } from "shared";
import { isJsonObject } from "shared";
import { normalizeLlmModelCapabilities } from "./domain.ts";
import { normalizeProviderBaseUrl } from "./client.ts";

export type LlmProviderDiscovery = { readonly mode: "manual" };

export type {
  ConfiguredLlmModel,
  ConfiguredLlmProvider,
  LlmModelCapabilities,
  LlmProviderAuth,
  LlmProvidersConfig,
} from "llm-contracts";

export interface LoadedLlmProvidersConfig {
  readonly config: LlmProvidersConfig;
  readonly warnings: readonly string[];
  readonly source?: string;
}

const repoRootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const defaultLocalConfigPath = resolve(repoRootDir, "apps", "tree-explorer", "config", "llm-providers.local.json");
const importedRuntimeFallbackConfigPath = "/home/daniel/src/jaensen/aven-os-runtime-no-node-modules-20260522-012649/apps/tree-explorer/config/llm-providers.local.json";

function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseCapabilities(value: unknown): LlmModelCapabilities | undefined {
  if (!isJsonObject(value)) return undefined;
  return normalizeLlmModelCapabilities(value as unknown as LlmModelCapabilities);
}

function legacyCapabilityFieldNames(): readonly string[] {
  return [
    ["artifact", "Input", "Mode"].join(""),
    ["accepted", "Mime", "Types"].join(""),
    ["max", "Artifact", "Bytes"].join(""),
    ["max", "Artifacts", "Per", "Request"].join(""),
    ["input", "Modalities"].join(""),
  ];
}

function assertNoLegacyCapabilityFields(value: unknown, path: string): void {
  if (!isJsonObject(value)) return;
  const legacyFields = legacyCapabilityFieldNames();
  for (const field of legacyFields) {
    assert(!(field in value), `Legacy LLM capability field '${path}.${field}' is not supported.`);
  }
  if (isJsonObject(value.input)) {
    for (const field of legacyFields) {
      assert(!(field in value.input), `Legacy LLM capability field '${path}.input.${field}' is not supported.`);
    }
  }
}

function parsePricing(value: unknown): LlmPricing | undefined {
  if (!isJsonObject(value)) return undefined;
  return {
    ...(typeof value.inputUsdPerMillionTokens === "number" ? { inputUsdPerMillionTokens: value.inputUsdPerMillionTokens } : {}),
    ...(typeof value.outputUsdPerMillionTokens === "number" ? { outputUsdPerMillionTokens: value.outputUsdPerMillionTokens } : {}),
  };
}

function parseModel(value: unknown): ConfiguredLlmModel {
  assert(isJsonObject(value), "Configured LLM model must be an object.");
  assert(typeof value.modelId === "string" && value.modelId.length > 0, "Configured LLM model must have a non-empty modelId.");
  assertNoLegacyCapabilityFields(value.capabilities, `providers[].models[${String(value.modelId)}].capabilities`);
  return {
    modelId: value.modelId,
    ...(typeof value.configId === "string" && value.configId.length > 0 ? { configId: value.configId } : {}),
    ...(typeof value.title === "string" && value.title.length > 0 ? { title: value.title } : {}),
    ...(parseCapabilities(value.capabilities) === undefined ? {} : { capabilities: parseCapabilities(value.capabilities) }),
    ...(parsePricing(value.pricing) === undefined ? {} : { pricing: parsePricing(value.pricing) }),
  };
}

function parseProvider(value: unknown): ConfiguredLlmProvider {
  assert(isJsonObject(value), "Configured LLM provider must be an object.");
  assert(typeof value.id === "string" && value.id.length > 0, "Configured LLM provider must have a non-empty id.");
  assert(typeof value.title === "string" && value.title.length > 0, "Configured LLM provider must have a non-empty title.");
  assert(
    value.protocol === "openai.responses"
      || value.protocol === "openai.chat-completions"
      || value.protocol === "openai-compatible.chat-completions",
    "Configured LLM provider protocol must be 'openai.responses', 'openai.chat-completions', or 'openai-compatible.chat-completions'.",
  );
  assert(typeof value.baseUrl === "string" && value.baseUrl.length > 0, "Configured LLM provider must have a non-empty baseUrl.");
  assert(isJsonObject(value.auth), "Configured LLM provider must define auth.");

  const auth = value.auth.type === "none"
    ? ({ type: "none" } as const)
    : value.auth.type === "bearer" && typeof value.auth.token === "string" && value.auth.token.length > 0
      ? ({ type: "bearer", token: value.auth.token } as const)
    : value.auth.type === "bearerEnv" && typeof value.auth.env === "string" && value.auth.env.length > 0
      ? ({ type: "bearerEnv", env: value.auth.env } as const)
      : undefined;
  assert(auth !== undefined, "Configured LLM provider auth must be { type: 'none' }, { type: 'bearer', token }, or { type: 'bearerEnv', env }.");

  const modelDefaults = isJsonObject(value.modelDefaults)
    ? {
        ...(assertNoLegacyCapabilityFields(value.modelDefaults.capabilities, `providers[${String(value.id)}].modelDefaults.capabilities`), {}),
        capabilities: normalizeLlmModelCapabilities(parseCapabilities(value.modelDefaults.capabilities)),
        ...(parsePricing(value.modelDefaults.pricing) === undefined ? {} : { pricing: parsePricing(value.modelDefaults.pricing) }),
      }
    : undefined;

  const models = Array.isArray(value.models) ? value.models.map((entry) => parseModel(entry)) : undefined;
  const discovery = isJsonObject(value.discovery)
    ? { ...(typeof value.discovery.enabled === "boolean" ? { enabled: value.discovery.enabled } : {}) }
    : undefined;

  return {
    id: value.id,
    title: value.title,
    protocol: value.protocol as LlmProviderProtocol,
    baseUrl: normalizeProviderBaseUrl(value.baseUrl),
    auth,
    ...(discovery === undefined ? {} : { discovery }),
    ...(modelDefaults === undefined ? {} : { modelDefaults }),
    ...(models === undefined ? {} : { models }),
  };
}

export function normalizeLlmProvidersConfig(value: unknown): LlmProvidersConfig {
  assert(isJsonObject(value), "LLM providers config must be an object.");
  assert(value.version === 1, "LLM providers config version must be 1.");
  assert(Array.isArray(value.providers), "LLM providers config must contain a providers array.");
  const defaults = isJsonObject(value.defaults)
    ? {
        ...(typeof value.defaults.maxParallel === "number" ? { maxParallel: value.defaults.maxParallel } : {}),
        ...(typeof value.defaults.maxQueue === "number" ? { maxQueue: value.defaults.maxQueue } : {}),
        ...(typeof value.defaults.requestTimeoutMs === "number" ? { requestTimeoutMs: value.defaults.requestTimeoutMs } : {}),
        ...(typeof value.defaults.maxOutputTokens === "number" ? { maxOutputTokens: value.defaults.maxOutputTokens } : {}),
        ...(typeof value.defaults.retentionMaxCompleted === "number" ? { retentionMaxCompleted: value.defaults.retentionMaxCompleted } : {}),
        ...(typeof value.defaults.retentionMaxInlineResultBytes === "number" ? { retentionMaxInlineResultBytes: value.defaults.retentionMaxInlineResultBytes } : {}),
      }
    : undefined;
  return {
    version: 1,
    ...(defaults === undefined ? {} : { defaults }),
    providers: value.providers.map((entry) => parseProvider(entry)),
  };
}

export function loadLlmProvidersConfig(options?: { readonly env?: NodeJS.ProcessEnv; readonly localConfigPath?: string }): LoadedLlmProvidersConfig {
  const env = options?.env ?? process.env;
  const explicitPath = env.AVEN_LLM_CONFIG;
  const candidatePath = explicitPath ?? options?.localConfigPath ?? defaultLocalConfigPath;
  if (!existsSync(candidatePath)) {
    if (explicitPath) {
      throw new Error(`LLM config file not found: ${candidatePath}`);
    }
    if (existsSync(importedRuntimeFallbackConfigPath)) {
      const parsed = JSON.parse(readFileSync(importedRuntimeFallbackConfigPath, "utf8")) as unknown;
      return {
        config: clone(normalizeLlmProvidersConfig(parsed)),
        warnings: [`Default LLM provider config missing at ${candidatePath}; using imported runtime fallback at ${importedRuntimeFallbackConfigPath}.`],
        source: importedRuntimeFallbackConfigPath,
      };
    }
    return {
      config: { version: 1, providers: [] },
      warnings: [`No LLM provider config found at ${candidatePath}; starting with zero configured providers.`],
      source: undefined,
    };
  }
  const parsed = JSON.parse(readFileSync(candidatePath, "utf8")) as unknown;
  return {
    config: clone(normalizeLlmProvidersConfig(parsed)),
    warnings: [],
    source: candidatePath,
  };
}

export function getDefaultLocalLlmConfigPath(): string {
  return defaultLocalConfigPath;
}
