import type {
  ActorDefinitionMap,
  ActorId,
  ActorIdString,
  ActorPersistence,
  ActorPresentation,
  ActorRef,
  ActorRegistry,
  ActorStatus,
  BehaviorOf,
  Clock,
  JsonValue,
  StateOf,
} from "typed-actors";
import type { StoredActor } from "typed-actors";
import type { TreeNodePath, TreeNodeRef } from "./tree-path.js";

export const SystemTreeNodeType = {
  Root: "root",
  RealActor: "realActor",
} as const;

export type SystemTreeNodeType = (typeof SystemTreeNodeType)[keyof typeof SystemTreeNodeType];

export type TreeNodeRuntimeIndicator = "busy" | "error";

export interface SystemTreeNode {
  readonly path: TreeNodePath;
  readonly nodeType: SystemTreeNodeType;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly tags?: readonly string[];
  readonly sortKey?: string;
  readonly status?: ActorStatus | string;
  readonly ownerActorId?: ActorIdString;
  readonly actorId?: ActorIdString;
  readonly actorKind?: string;
  readonly behavior?: string;
  readonly generation?: number;
  readonly version?: number;
  readonly hasChildren: boolean;
  readonly childCount?: number;
  readonly runtimeIndicator?: TreeNodeRuntimeIndicator;
  readonly summary?: JsonValue;
  readonly presentation?: ActorPresentation;
}

export interface SystemTree {
  readonly takenAt: string;
  readonly root: SystemTreeBranch;
}

export interface SystemTreeBranch {
  readonly node: SystemTreeNode;
  readonly children: readonly SystemTreeBranch[];
}

export interface SystemTreeOptions {
  readonly root?: TreeNodeRef | ActorId | string;
  readonly includeStopped?: boolean;
  readonly maxDepth?: number;
}

export interface RealTreeNodeSpec {
  readonly title?: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly tags?: readonly string[];
  readonly sortKey?: string;
  readonly hasChildren?: boolean;
  readonly childCount?: number;
  readonly summary?: JsonValue;
}

export interface ActorTreeInspectionInput<R extends ActorRegistry, K extends Extract<keyof R, string>> {
  readonly self: ActorRef<R, K>;
  readonly status: ActorStatus;
  readonly behavior: BehaviorOf<R, K>;
  readonly state: Readonly<StateOf<R, K>>;
  readonly generation: number;
  readonly version: number;
  readonly nodePath: TreeNodePath;
  readonly now: Date;
}

export interface ActorSystemPresentationDefinition<R extends ActorRegistry, K extends Extract<keyof R, string>> {
  describeSelf?(input: ActorTreeInspectionInput<R, K>): RealTreeNodeSpec | undefined | Promise<RealTreeNodeSpec | undefined>;
}

export type ActorTreePresentationMap<R extends ActorRegistry> = Partial<Record<Extract<keyof R, string>, ActorSystemPresentationDefinition<R, any>>>;

export interface SystemTreeInspector<R extends ActorRegistry> {
  inspectTree(options?: SystemTreeOptions): Promise<SystemTree>;
  inspectNode(path: TreeNodeRef | ActorId | string): Promise<SystemTreeNode | undefined>;
}

export interface CreateSystemTreeInspectorOptions<R extends ActorRegistry> {
  readonly persistence: ActorPersistence;
  readonly definitions: ActorDefinitionMap<R>;
  readonly presentations?: ActorTreePresentationMap<R>;
  readonly clock?: Clock;
}

export interface ProjectionPresentationInput<R extends ActorRegistry> {
  readonly definitions: ActorDefinitionMap<R>;
  readonly actor: StoredActor;
}