import { ActorId, openAvenSqliteDatabase, type AvenSqliteDatabase, type ActorDefinitionMap } from "typed-actors";
import type { ActorTreePresentationMap } from "typed-actors-introspection";
import type { AvenRegistry } from "../../runtime/src/spine.ts";
import type { ArtifactStorage } from "../../artifacts/src/subsystem.ts";
import { SqliteArtifactStorage } from "../../artifacts/src/subsystem.ts";
import { StructuredExtractionActor, type StructuredExtractionActorMessage, type StructuredExtractionActorState } from "./actors/structured-extraction/actor.ts";

export type StructuredExtractionRuntimeActorKind = typeof import("../../runtime/src/spine.ts").ActorKind;

export interface BuildStructuredExtractionSubsystemArgs {
  readonly registry: AvenRegistry;
  readonly ActorKind: StructuredExtractionRuntimeActorKind;
  readonly storage?: ArtifactStorage;
  readonly sqliteDb?: AvenSqliteDatabase;
  readonly llmsActorId?: ActorId;
  readonly metadataActorId?: ActorId;
}

export interface StructuredExtractionSubsystemSupport {
  readonly registry: AvenRegistry;
  readonly ActorKind: StructuredExtractionRuntimeActorKind;
  readonly storage: ArtifactStorage;
  readonly llmsActorId: ActorId;
  readonly metadataActorId: ActorId;
  clone<T>(value: T): T;
}

function createStructuredExtractionSubsystemSupport(args: BuildStructuredExtractionSubsystemArgs): StructuredExtractionSubsystemSupport {
  return {
    registry: args.registry,
    ActorKind: args.ActorKind,
    storage: args.storage ?? new SqliteArtifactStorage(args.sqliteDb ?? openAvenSqliteDatabase("./aven-runtime.db")),
    llmsActorId: args.llmsActorId ?? ActorId.parse("/aven/system/llms"),
    metadataActorId: args.metadataActorId ?? ActorId.parse("/aven/system/metadata"),
    clone: structuredClone,
  };
}

export function buildStructuredExtractionSubsystemBundle(args: BuildStructuredExtractionSubsystemArgs) {
  return {
    definitions: buildStructuredExtractionSubsystemDefinitions(args),
    presentations: buildStructuredExtractionSubsystemPresentations(args),
  } as const;
}

export function buildStructuredExtractionSubsystemDefinitions(args: BuildStructuredExtractionSubsystemArgs) {
  const support = createStructuredExtractionSubsystemSupport(args);
  const actor = new StructuredExtractionActor(support);
  return {
    [args.ActorKind.StructuredExtraction]: actor.buildDefinition(),
  } as Pick<ActorDefinitionMap<typeof args.registry>, typeof args.ActorKind.StructuredExtraction>;
}

export function buildStructuredExtractionSubsystemPresentations(_args: BuildStructuredExtractionSubsystemArgs): ActorTreePresentationMap<AvenRegistry> {
  return {};
}

export type { StructuredExtractionActorMessage, StructuredExtractionActorState };