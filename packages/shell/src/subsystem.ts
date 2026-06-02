import { openAvenSqliteDatabase, type AvenSqliteDatabase } from "typed-actors";
import type { ActorDefinitionMap } from "typed-actors";
import type { ActorTreePresentationMap } from "typed-actors-introspection";
import type { AvenRegistry } from "../../runtime/src/spine.ts";
import type { ArtifactStorage } from "../../artifacts/src/subsystem.ts";
import { SqliteArtifactStorage } from "../../artifacts/src/subsystem.ts";
import type { ShellToolConfig } from "../../shell-contracts/src/index.ts";
import {
  ShellActor,
  type ShellActorMessage,
  type ShellActorState,
  type ShellWorkerActorMessage,
  type ShellWorkerActorState,
} from "./actors/shell/actor.ts";

export const DEFAULT_SHELL_TOOL_CONFIG: ShellToolConfig = {
  maxInlineOutputChars: 1024,
  maxMemoryBytes: 10_485_760,
  defaultTimeoutSeconds: 30,
  maxTimeoutSeconds: 300,
  cwd: process.cwd(),
  allowedCommands: [],
  env: {},
};

export type ShellRuntimeActorKind = typeof import("../../runtime/src/spine.ts").ActorKind;

export interface BuildShellSubsystemArgs {
  readonly registry: AvenRegistry;
  readonly ActorKind: ShellRuntimeActorKind;
  readonly storage?: ArtifactStorage;
  readonly sqliteDb?: AvenSqliteDatabase;
  readonly config?: Partial<ShellToolConfig>;
}

export interface ShellSubsystemSupport {
  readonly registry: AvenRegistry;
  readonly ActorKind: ShellRuntimeActorKind;
  readonly storage: ArtifactStorage;
  readonly config: ShellToolConfig;
}

function createShellSubsystemSupport(args: BuildShellSubsystemArgs): ShellSubsystemSupport {
  return {
    registry: args.registry,
    ActorKind: args.ActorKind,
    storage: args.storage ?? new SqliteArtifactStorage(args.sqliteDb ?? openAvenSqliteDatabase("./aven-runtime.db")),
    config: { ...DEFAULT_SHELL_TOOL_CONFIG, ...args.config },
  };
}

export function buildShellSubsystemBundle(args: BuildShellSubsystemArgs) {
  return {
    definitions: buildShellSubsystemDefinitions(args),
    presentations: buildShellSubsystemPresentations(args),
  } as const;
}

export function buildShellSubsystemDefinitions(args: BuildShellSubsystemArgs) {
  const support = createShellSubsystemSupport(args);
  const actor = new ShellActor(support);
  return {
    [args.ActorKind.Shell]: actor.buildDefinition(),
    [args.ActorKind.ShellWorker]: actor.buildWorkerDefinition(),
  } as Pick<ActorDefinitionMap<typeof args.registry>, typeof args.ActorKind.Shell | typeof args.ActorKind.ShellWorker>;
}

export function buildShellSubsystemPresentations(_args: BuildShellSubsystemArgs): ActorTreePresentationMap<AvenRegistry> {
  return {};
}

export type { ShellActorMessage, ShellActorState, ShellWorkerActorMessage, ShellWorkerActorState };