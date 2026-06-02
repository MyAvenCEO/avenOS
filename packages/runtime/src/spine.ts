import { createHash, randomUUID } from "node:crypto";
import { createSystemTreeInspector, type ActorTreePresentationMap, type SystemTreeInspector } from "typed-actors-introspection";
import {
  ActorId,
  openAvenSqliteDatabase,
  type AvenSqliteDatabase,
  SqliteActorPersistence,
  actorType,
  createActorSystem,
  defineRegistry,
  type ActorSystem,
  type JsonValue,
  type RuntimeInfrastructureEvent,
} from "typed-actors";
import { groupDebugMessageDescriptorsByActorKind } from "../../shared/src/index.ts";
import { InfrastructureLogCode, InfrastructureLogLevel, type AppendInfrastructureLogMessage, type InfrastructureLogEntry } from "../../actor-contracts/src/index.ts";
import type { LlmModelCapabilities, LlmProvidersConfig } from "llm-contracts";
import type { IntentRuntimeConfig } from "intents-contracts";
import { buildArtifactSubsystemBundle, artifactDebugMessageDescriptors, artifactReaderDebugMessageDescriptors, SqliteArtifactStorage } from "../../artifacts/src/subsystem.ts";
import { llmDebugMessageDescriptors, type BuildLlmSubsystemOptions } from "../../llm/src/subsystem.ts";
import { buildPreparedLlmSubsystemBundle } from "../../llm/src/prepared-subsystem.ts";
import { buildMetadataSubsystemBundle, metadataDebugMessageDescriptors, type MetadataActorMessage, type MetadataActorState } from "../../metadata/src/subsystem.ts";
import {
  buildSchemaSubsystemBundle,
  getSchemaRegistryActorId as getSchemaRegistryActorPath,
  schemaActorDebugMessageDescriptors,
  schemaDebugMessageDescriptors,
  validateDebugMessage as validateSchemaDebugMessage,
  type SchemaActorState,
  type SchemaMessage,
  type SchemaRegistryMessage,
  type SchemaRegistryState,
} from "../../schema/src/subsystem.ts";
import { bootstrapBundledSchemas } from "../../schema/src/bootstrap.ts";
import {
  buildHumanSubsystemBundle,
  humanDebugMessageDescriptors,
  type HumanActorMessage,
  type HumanActorState,
} from "../../human/src/subsystem.ts";
import {
  buildIntentSubsystemBundle,
  intentDebugMessageDescriptors,
  intentsDebugMessageDescriptors,
  IntentToolRunKind,
  type IntentRuntimeConfigInit,
  type IntentActorMessage,
  type IntentActorState,
  type IntentToolRunMessage,
  type IntentToolRunState,
  type IntentsRouterMessage,
  type IntentsRouterState,
} from "../../intents/src/subsystem.ts";
import { buildShellSubsystemBundle, type ShellActorMessage, type ShellActorState } from "../../shell/src/subsystem.ts";
import { buildStructuredExtractionSubsystemBundle, type StructuredExtractionActorMessage, type StructuredExtractionActorState } from "../../structured-extraction/src/subsystem.ts";
import { loadLlmProvidersConfig } from "../../llm/src/provider-config.ts";
import { createAvenLogActor, type AvenLogActorInit, type AvenLogActorState } from "./actors/log/actor.ts";
import { RequestResultsActor } from "./actors/request-results/actor.ts";
import { createAvenRootActor } from "./actors/root/actor.ts";
import { createAvenSystemActor } from "./actors/system/actor.ts";
import { ActorCreateMode } from "typed-actors";
import type { RequestResultsMessage, RequestResultsState } from "./request-results.ts";

export interface DebugMessageDescriptor {
  readonly id: string;
  readonly actorKind: string;
  readonly title: string;
  readonly description?: string;
  readonly messageType: string;
  readonly schema: JsonValue;
  readonly defaultValue: JsonValue;
  readonly dangerous?: boolean;
}

export interface SendDebugMessageRequest {
  readonly actorId: string;
  readonly actorKind: string;
  readonly descriptorId: string;
  readonly message: JsonValue;
  readonly runMode: "enqueue" | "runOne" | "runUntilIdle";
}

export const ActorKind = {
  Aven: "aven",
  AvenSystem: "avenSystem",
  Log: "log",
  RequestResults: "requestResults",
  Intents: "intents",
  Intent: "intent",
  IntentToolRun: "intentToolRun",
  SchemaRegistry: "schemaRegistry",
  Schema: "schema",
  Artifacts: "artifacts",
  ArtifactReaderRegistry: "artifactReaderRegistry",
  ByteArtifactReader: "byteArtifactReader",
  TextArtifactReader: "textArtifactReader",
  JsonArtifactReader: "jsonArtifactReader",
  Shell: "shell",
  ShellWorker: "shellWorker",
  Metadata: "metadata",
  Human: "human",
  StructuredExtraction: "structuredExtraction",
  Llms: "llms",
  LlmProvider: "llmProvider",
  LlmModel: "llmModel",
  LlmRequestWorker: "llmRequestWorker",
} as const;

type AvenState = { readonly ready: true };
type AvenMessage = { readonly type: "noop" };
type AvenSystemState = { readonly ready: true };
type AvenSystemMessage = { readonly type: "noop" };

export const registry = defineRegistry({
  [ActorKind.Aven]: actorType<AvenState, AvenMessage, {}, "active", typeof ActorKind.AvenSystem | typeof ActorKind.Intents>(),
  [ActorKind.AvenSystem]: actorType<AvenSystemState, AvenSystemMessage, {}, "active", typeof ActorKind.Log | typeof ActorKind.RequestResults | typeof ActorKind.SchemaRegistry | typeof ActorKind.Artifacts | typeof ActorKind.ArtifactReaderRegistry | typeof ActorKind.Shell | typeof ActorKind.Metadata | typeof ActorKind.Human | typeof ActorKind.StructuredExtraction | typeof ActorKind.Llms>(),
  [ActorKind.Log]: actorType<AvenLogActorState, AppendInfrastructureLogMessage, AvenLogActorInit, "active", never>(),
  [ActorKind.RequestResults]: actorType<RequestResultsState, RequestResultsMessage, {}, "active", never>(),
  [ActorKind.Intents]: actorType<IntentsRouterState, IntentsRouterMessage, IntentRuntimeConfigInit, "active", typeof ActorKind.Intent>(),
  [ActorKind.Intent]: actorType<IntentActorState, IntentActorMessage, { readonly intentId: string; readonly title: string; readonly goal: string }, "active", typeof ActorKind.IntentToolRun>(),
  [ActorKind.IntentToolRun]: actorType<IntentToolRunState, IntentToolRunMessage, IntentToolRunState, "active", never>(),
  [ActorKind.SchemaRegistry]: actorType<SchemaRegistryState, SchemaRegistryMessage, SchemaRegistryState, "active", typeof ActorKind.Schema>(),
  [ActorKind.Schema]: actorType<SchemaActorState, SchemaMessage, { readonly schemaId: string }, "active", never>(),
  [ActorKind.Artifacts]: actorType<import("../../artifacts/src/subsystem.ts").ArtifactActorState, import("../../artifacts/src/subsystem.ts").ArtifactActorMessage, {}, "active", never>(),
  [ActorKind.ArtifactReaderRegistry]: actorType<import("../../artifacts/src/subsystem.ts").ArtifactReaderRegistryState, import("../../artifacts/src/subsystem.ts").ArtifactReaderRegistryMessage, {}, "active", typeof ActorKind.ByteArtifactReader | typeof ActorKind.TextArtifactReader | typeof ActorKind.JsonArtifactReader>(),
  [ActorKind.ByteArtifactReader]: actorType<import("../../artifacts/src/subsystem.ts").ByteArtifactReaderState, import("../../artifacts/src/subsystem.ts").ByteArtifactReaderMessage, {}, "active", never>(),
  [ActorKind.TextArtifactReader]: actorType<import("../../artifacts/src/subsystem.ts").TextArtifactReaderState, import("../../artifacts/src/subsystem.ts").TextArtifactReaderMessage, {}, "active", never>(),
  [ActorKind.JsonArtifactReader]: actorType<import("../../artifacts/src/subsystem.ts").JsonArtifactReaderState, import("../../artifacts/src/subsystem.ts").JsonArtifactReaderMessage, {}, "active", never>(),
  [ActorKind.Shell]: actorType<ShellActorState, ShellActorMessage, {}, "active", typeof ActorKind.ShellWorker>(),
  [ActorKind.ShellWorker]: actorType<import("../../shell/src/subsystem.ts").ShellWorkerActorState, import("../../shell/src/subsystem.ts").ShellWorkerActorMessage, import("../../shell/src/subsystem.ts").ShellWorkerActorState, "active", never>(),
  [ActorKind.Metadata]: actorType<MetadataActorState, MetadataActorMessage, {}, "active", never>(),
  [ActorKind.Human]: actorType<HumanActorState, HumanActorMessage, {}, "active", never>(),
  [ActorKind.StructuredExtraction]: actorType<StructuredExtractionActorState, StructuredExtractionActorMessage, {}, "active", never>(),
  [ActorKind.Llms]: actorType<import("../../llm/src/subsystem.ts").LlmsState, import("../../llm/src/subsystem.ts").LlmsMessage, {}, "active", typeof ActorKind.LlmProvider>(),
  [ActorKind.LlmProvider]: actorType<import("../../llm/src/subsystem.ts").LlmProviderState, import("../../llm/src/subsystem.ts").LlmProviderMessage, import("../../llm/src/subsystem.ts").LlmProviderState, "active", typeof ActorKind.LlmModel>(),
  [ActorKind.LlmModel]: actorType<import("../../llm/src/subsystem.ts").LlmModelState, import("../../llm/src/subsystem.ts").LlmModelMessage, import("../../llm/src/subsystem.ts").LlmModelState, "active", typeof ActorKind.LlmRequestWorker>(),
  [ActorKind.LlmRequestWorker]: actorType<import("../../llm/src/subsystem.ts").LlmRequestWorkerState, import("../../llm/src/subsystem.ts").LlmRequestWorkerMessage, import("../../llm/src/subsystem.ts").LlmRequestWorkerState, "active", never>(),
});

export type AvenRegistry = typeof registry;
export type AvenActors = ActorSystem<typeof registry>;
export interface AvenRuntime {
  readonly actors: AvenActors;
  readonly tree: SystemTreeInspector<typeof registry>;
}
export type AvenSystem = AvenRuntime & AvenActors & Pick<SystemTreeInspector<typeof registry>, "inspectTree" | "inspectNode">;

const debugMessageDescriptors = groupDebugMessageDescriptorsByActorKind([
  ...intentsDebugMessageDescriptors,
  ...intentDebugMessageDescriptors,
  ...schemaDebugMessageDescriptors,
  ...schemaActorDebugMessageDescriptors,
  ...artifactDebugMessageDescriptors,
  ...artifactReaderDebugMessageDescriptors,
  ...metadataDebugMessageDescriptors,
  ...humanDebugMessageDescriptors,
  ...llmDebugMessageDescriptors,
]) satisfies Readonly<Record<string, readonly DebugMessageDescriptor[]>>;

function ensureMessageType(descriptor: DebugMessageDescriptor, message: JsonValue): JsonValue {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return message;
  }
  return { type: descriptor.messageType, ...message } as JsonValue;
}

function defaultRuntimeSqliteDb(options?: BuildLlmSubsystemOptions): AvenSqliteDatabase | undefined {
  return options?.sqliteDb;
}

export function createDefinitions(options?: BuildLlmSubsystemOptions) {
  const sqliteDb = defaultRuntimeSqliteDb(options) ?? openAvenSqliteDatabase("./aven-runtime.db");
  const artifactStorage = options?.artifactStorage ?? new SqliteArtifactStorage(sqliteDb);
  const schemaBundle = buildSchemaSubsystemBundle({ registry, ActorKind });
  const artifactBundle = buildArtifactSubsystemBundle({ registry, ActorKind, storage: artifactStorage, sqliteDb });
  const shellBundle = buildShellSubsystemBundle({ registry, ActorKind, storage: artifactStorage, sqliteDb });
  const metadataBundle = buildMetadataSubsystemBundle({ registry, ActorKind, sqliteDb });
  const humanBundle = buildHumanSubsystemBundle({ registry, ActorKind });
  const structuredExtractionBundle = buildStructuredExtractionSubsystemBundle({ registry, ActorKind, storage: artifactStorage, sqliteDb });
  const intentBundle = buildIntentSubsystemBundle({ registry, ActorKind });
  const llmBundle = buildPreparedLlmSubsystemBundle({ registry, ActorKind, options: { ...options, artifactStorage } });
  const requestResults = new RequestResultsActor();
  return {
    [ActorKind.Aven]: createAvenRootActor(options),
    [ActorKind.AvenSystem]: createAvenSystemActor(),
    [ActorKind.Log]: createAvenLogActor(),
    [ActorKind.RequestResults]: requestResults.buildDefinition(),
    ...schemaBundle.definitions,
    ...artifactBundle.definitions,
    ...shellBundle.definitions,
    ...metadataBundle.definitions,
    ...humanBundle.definitions,
    ...structuredExtractionBundle.definitions,
    ...intentBundle.definitions,
    ...llmBundle.definitions,
  };
}

export function createActorPresentations(options?: BuildLlmSubsystemOptions): ActorTreePresentationMap<typeof registry> {
  const sqliteDb = defaultRuntimeSqliteDb(options) ?? openAvenSqliteDatabase("./aven-runtime.db");
  const artifactStorage = options?.artifactStorage ?? new SqliteArtifactStorage(sqliteDb);
  const schemaBundle = buildSchemaSubsystemBundle({ registry, ActorKind });
  const artifactBundle = buildArtifactSubsystemBundle({ registry, ActorKind, storage: artifactStorage, sqliteDb });
  const shellBundle = buildShellSubsystemBundle({ registry, ActorKind, storage: artifactStorage, sqliteDb });
  const metadataBundle = buildMetadataSubsystemBundle({ registry, ActorKind, sqliteDb });
  const humanBundle = buildHumanSubsystemBundle({ registry, ActorKind });
  const structuredExtractionBundle = buildStructuredExtractionSubsystemBundle({ registry, ActorKind, storage: artifactStorage, sqliteDb });
  const intentBundle = buildIntentSubsystemBundle({ registry, ActorKind });
  const llmBundle = buildPreparedLlmSubsystemBundle({ registry, ActorKind, options: { ...options, artifactStorage } });
  return {
    ...schemaBundle.presentations,
    ...artifactBundle.presentations,
    ...shellBundle.presentations,
    ...metadataBundle.presentations,
    ...humanBundle.presentations,
    ...structuredExtractionBundle.presentations,
    ...intentBundle.presentations,
    ...llmBundle.presentations,
  } satisfies ActorTreePresentationMap<typeof registry>;
}

export function getDebugMessageDescriptors(actorKind: string): readonly DebugMessageDescriptor[] {
  return debugMessageDescriptors[actorKind] ?? [];
}

export function getDebugMessageDescriptor(actorKind: string, descriptorId: string): DebugMessageDescriptor | undefined {
  return getDebugMessageDescriptors(actorKind).find((descriptor) => descriptor.id === descriptorId || descriptor.messageType === descriptorId);
}

export function validateDebugMessage(descriptor: DebugMessageDescriptor, message: unknown): string[] {
  return validateSchemaDebugMessage(descriptor, message);
}

export function materializeDebugMessage(descriptor: DebugMessageDescriptor, message: JsonValue): JsonValue {
  return ensureMessageType(descriptor, message);
}

export function getSchemaRegistryActorId(): ActorId {
  return ActorId.parse(getSchemaRegistryActorIdString());
}

export function getSchemaRegistryActorIdString(): string {
  return getSchemaRegistryActorPath();
}

function effectiveLlmConfig(options?: BuildLlmSubsystemOptions): LlmProvidersConfig {
  return options?.llmConfig ?? loadLlmProvidersConfig().config;
}

function toInfrastructureLogEntry(event: RuntimeInfrastructureEvent): InfrastructureLogEntry {
  switch (event.type) {
    case "activationFailed":
      return {
        id: randomUUID(),
        occurredAt: event.occurredAt,
        level: InfrastructureLogLevel.Error,
        code: InfrastructureLogCode.ActivationFailed,
        message: `Activation failed for ${event.actorKind} at ${event.actorId}`,
        actorId: event.actorId,
        actorKind: event.actorKind,
        envelopeId: event.envelopeId,
        messageType: event.messageType,
        error: event.error,
      };
    case "supervisionApplied":
      return {
        id: randomUUID(),
        occurredAt: event.occurredAt,
        level: InfrastructureLogLevel.Warn,
        code: InfrastructureLogCode.SupervisionApplied,
        message: `Supervision ${event.directive} applied to ${event.childId}`,
        actorId: event.parentId,
        parentId: event.parentId,
        childId: event.childId,
        directive: event.directive,
        envelopeId: event.failure.envelope.id,
        messageType: event.failure.envelope.messageType,
        error: event.failure.error,
      };
    case "schedulerFailed":
      return {
        id: randomUUID(),
        occurredAt: event.occurredAt,
        level: InfrastructureLogLevel.Error,
        code: InfrastructureLogCode.SchedulerFailed,
        message: "Scheduler failed while running automatic actor work",
        error: event.error,
      };
    case "externalMessageRejected":
      return {
        id: randomUUID(),
        occurredAt: event.occurredAt,
        level: InfrastructureLogLevel.Warn,
        code: InfrastructureLogCode.ExternalMessageRejected,
        message: `Rejected external message for ${event.actorKind} at ${event.actorId}: ${event.reason}`,
        actorId: event.actorId,
        actorKind: event.actorKind,
        messageType: event.messageType,
        error: event.error,
      };
  }
}

export function defaultIntentRuntimeFromLlmConfig(options?: BuildLlmSubsystemOptions) {
  const config = effectiveLlmConfig(options);
  const provider = config.providers[0];
  if (!provider) {
    return undefined;
  }
  return {
    planner: {
      requirements: {
        input: { modalities: ["text"] as const },
        output: { modalities: ["text"] as const },
      },
    },
    toolDefaults: {
      structuredExtraction: {
        requirements: {
          input: { modalities: ["text", "image"] as const },
          output: { modalities: ["text", "json"] as const },
          general: { requires: ["structuredOutput"] as const },
        },
      },
    },
  } satisfies IntentRuntimeConfig;
}

export async function createAvenRuntime(options?: BuildLlmSubsystemOptions): Promise<AvenRuntime> {
  const sqliteDb = defaultRuntimeSqliteDb(options) ?? openAvenSqliteDatabase("./aven-runtime.db");
  const artifactStorage = options?.artifactStorage ?? new SqliteArtifactStorage(sqliteDb);
  const definitions = createDefinitions({ ...options, artifactStorage, sqliteDb });
  const persistence = options?.persistence ?? new SqliteActorPersistence(sqliteDb);
  let actors!: AvenActors;
  actors = createActorSystem({
    registry,
    definitions,
    persistence,
    runtime: {
      activationTimeoutMs: 120_000,
      leaseMs: 150_000,
      concurrency: Math.max(1, options?.runtimeConcurrency ?? 4),
      supervision: {
        maxRestarts: 3,
        windowMs: 300_000,
        retryBackoffMs: 1_000,
      },
      infrastructureLogSink: {
        async emit(event) {
          if (!actors) {
            return;
          }
          await actors.send({ id: ActorId.parse("/aven/system/log"), kind: ActorKind.Log }, {
            type: "appendInfrastructureLog",
            entry: toInfrastructureLogEntry(event),
          } as AppendInfrastructureLogMessage);
        },
      },
    },
  });

  await actors.createRoot(ActorKind.Aven, {
    id: ActorId.root("aven"),
    init: {},
    ifExists: ActorCreateMode.OkIfSameKind,
  });
  await actors.runUntilIdle();

  const tree = createSystemTreeInspector({
    persistence,
    definitions,
    presentations: createActorPresentations({ ...options, artifactStorage }),
  });

  const compat = Object.assign(actors, {
    actors,
    tree,
    inspectTree: tree.inspectTree.bind(tree),
    inspectNode: tree.inspectNode.bind(tree),
  }) as AvenSystem;

  await bootstrapBundledSchemas(compat);

  return { actors, tree };
}

export async function createAvenSystem(options?: BuildLlmSubsystemOptions): Promise<AvenSystem> {
  const runtime = await createAvenRuntime(options);
  return Object.assign(runtime.actors, runtime, {
    inspectTree: runtime.tree.inspectTree.bind(runtime.tree),
    inspectNode: runtime.tree.inspectNode.bind(runtime.tree),
  }) as AvenSystem;
}
