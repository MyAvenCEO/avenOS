import type { ActorPersistence, AvenSqliteDatabase, JsonValue } from "typed-actors";
import type { ArtifactStorage } from "../../../../artifacts/src/subsystem.ts";
import type {
  AvailableLlmDescriptor,
  ConfiguredLlmModel,
  FindLlmsByCapabilitiesMessage,
  GetLlmUsageMessage,
  LlmCapabilityRequirements,
  LlmModelCapabilities,
  LlmProviderAuth,
  LlmPricing,
  LlmProvidersConfig,
  LlmRequest,
  LlmRequestCompleted,
  LlmResult,
  LlmUsageMeter,
  DescribeCapabilitiesMessage,
  ListAvailableLlmsMessage,
  GetResultMessage,
  ListModelsMessage,
  ListRequestsMessage,
  LlmProviderProtocol,
  ValidateLlmInputMessage,
} from "llm-contracts";
import type { SchemaValidationCompleted } from "schema-contracts";
import type { LlmHttpClient } from "../../client.ts";

/** Running model request tracked by the model actor while a worker actor is active. */
export interface RunningRequest {
  readonly requestId: string;
  readonly actorId: string;
  readonly startedAt: string;
  readonly request: Omit<LlmRequest, "requestId"> & { readonly requestId: string };
}

/** Queued model request waiting for available execution capacity. */
export interface QueuedRequest {
  readonly requestId: string;
  readonly enqueuedAt: string;
  readonly request: Omit<LlmRequest, "requestId"> & { readonly requestId: string };
}

/** Retained completed LLM request result stored for bounded inspection/history access. */
export interface CompletedLlmRequest {
  readonly requestId: string;
  readonly completedAt: string;
  readonly result: LlmResult;
}

/** Bounded retention policy controlling completed-request history and inline preview limits. */
export interface LlmRequestRetentionPolicy {
  readonly maxCompleted: number;
  readonly maxInlineResultBytes: number;
}

export interface LlmPendingGatewayRequest {
  readonly requestId: string;
  readonly callerActorId: string;
  readonly selectedModelActorPath: string;
  readonly selectedConfigId?: string;
  readonly pricing?: LlmPricing;
  readonly replyTo?: LlmRequest["replyTo"];
  readonly startedAt: string;
}

export interface LlmsState {
  readonly ready: true;
  readonly catalog: readonly AvailableLlmDescriptor[];
  readonly usageByCallerActorId: Readonly<Record<string, LlmUsageMeter>>;
  readonly pendingRequests: Readonly<Record<string, LlmPendingGatewayRequest>>;
}

/** Internal wait stage for a request worker while an LLM request is still in flight. */
export type LlmRequestWorkerAwaiting = "providerResponse" | "schemaValidation";

/** Runtime state of a configured LLM model actor under a provider. */
export interface LlmModelState {
  readonly providerId: string;
  readonly providerTitle: string;
  readonly providerProtocol: LlmProviderProtocol;
  readonly providerBaseUrl: string;
  readonly modelId: string;
  readonly configId: string;
  readonly title: string;
  readonly slug: string;
  readonly pricing?: LlmPricing;
  readonly available: boolean;
  readonly lastSeenAt?: string;
  readonly capabilities: LlmModelCapabilities;
  readonly maxParallel: number;
  readonly maxQueue: number;
  readonly defaultMaxOutputTokens?: number;
  readonly retention: LlmRequestRetentionPolicy;
  readonly nextRequestNumber: number;
  readonly queued: readonly QueuedRequest[];
  readonly running: Readonly<Record<string, RunningRequest>>;
  readonly completedRecent: Readonly<Record<string, CompletedLlmRequest>>;
  readonly completedOrder: readonly string[];
  readonly evictedCompletedCount: number;
}

/** Runtime state of a short-lived LLM request worker actor. */
export interface LlmRequestWorkerState {
  readonly providerId: string;
  readonly providerTitle: string;
  readonly providerProtocol: LlmProviderProtocol;
  readonly providerBaseUrl: string;
  readonly modelId: string;
  readonly configId: string;
  readonly capabilities: LlmModelCapabilities;
  readonly requestId: string;
  readonly status: "running" | "completed";
  readonly request: Omit<LlmRequest, "requestId"> & { readonly requestId: string };
  readonly pendingStructuredOutput?: JsonValue;
  readonly awaiting?: LlmRequestWorkerAwaiting;
  readonly result?: LlmResult;
}

/** Runtime state of an LLM provider actor that owns model children and provider defaults. */
export interface LlmProviderState {
  readonly providerId: string;
  readonly title: string;
  readonly protocol: LlmProviderProtocol;
  readonly baseUrl: string;
  readonly auth: LlmProviderAuth;
  readonly discovery?: {
    readonly enabled?: boolean;
  };
  readonly modelDefaults: {
    readonly capabilities: LlmModelCapabilities;
    readonly pricing?: LlmPricing;
  };
  readonly modelIds: readonly string[];
  readonly modelSlugsById: Readonly<Record<string, string>>;
  readonly modelsById: Readonly<Record<string, ConfiguredLlmModel>>;
  readonly defaults: {
    readonly maxParallel: number;
    readonly maxQueue: number;
    readonly maxOutputTokens?: number;
    readonly retentionMaxCompleted?: number;
    readonly retentionMaxInlineResultBytes?: number;
  };
}

export interface RegisterAvailableLlmMessage {
  readonly type: "registerAvailableLlm";
  readonly descriptor: AvailableLlmDescriptor;
}

export interface ReplaceProviderCatalogMessage {
  readonly type: "replaceProviderCatalog";
  readonly providerId: string;
  readonly descriptors: readonly AvailableLlmDescriptor[];
}

export interface RefreshModelConfigMessage {
  readonly type: "refreshModelConfig";
  readonly providerTitle: string;
  readonly providerProtocol: LlmProviderProtocol;
  readonly providerBaseUrl: string;
  readonly configId: string;
  readonly title: string;
  readonly capabilities: LlmModelCapabilities;
  readonly pricing?: LlmPricing;
  readonly maxParallel: number;
  readonly maxQueue: number;
  readonly defaultMaxOutputTokens?: number;
  readonly available: boolean;
  readonly lastSeenAt: string;
}

/** Messages accepted by an LLM model actor. */
export type LlmModelMessage = LlmRequest | ListRequestsMessage | { readonly type: "requestCompleted"; readonly requestId: string; readonly result: LlmResult } | DescribeCapabilitiesMessage | ValidateLlmInputMessage | RefreshModelConfigMessage;
/** Messages accepted by an LLM request worker actor. */
export type LlmRequestWorkerMessage = { readonly type: "beginProcessing" } | GetResultMessage | SchemaValidationCompleted;
/** Messages accepted by an LLM provider actor. */
export type LlmProviderMessage = ListModelsMessage;
/** Messages accepted by the public llms root gateway actor. */
export type LlmsMessage =
  | LlmRequest
  | ListAvailableLlmsMessage
  | FindLlmsByCapabilitiesMessage
  | GetLlmUsageMessage
  | LlmRequestCompleted
  | RegisterAvailableLlmMessage
  | ReplaceProviderCatalogMessage;

/** Composition/configuration inputs used when wiring the LLM subsystem into the runtime. */
export interface BuildLlmSubsystemOptions {
  readonly llmConfig?: LlmProvidersConfig;
  readonly llmClientsByProviderId?: Readonly<Record<string, LlmHttpClient>>;
  readonly llmRetention?: Partial<LlmRequestRetentionPolicy>;
  readonly artifactStorage?: ArtifactStorage;
  readonly persistence?: ActorPersistence;
  readonly sqliteDb?: AvenSqliteDatabase;
  readonly runtimeConcurrency?: number;
}
