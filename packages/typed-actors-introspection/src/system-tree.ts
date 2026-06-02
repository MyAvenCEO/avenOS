import {
  ActorId,
  ActorStatus,
  EnvelopeStatus,
  systemClock,
  type ActorDefinitionMap,
  type ActorPersistence,
  type ActorPresentation,
  type ActorRef,
  type ActorRegistry,
  type Clock,
  type JsonValue,
  type KindOf,
  type StoredActor,
  type StoredEnvelope,
} from "typed-actors";
import { cloneJson } from "typed-actors";
import {
  SystemTreeNodeType,
  type ActorTreeInspectionInput,
  type ActorTreePresentationMap,
  type CreateSystemTreeInspectorOptions,
  type RealTreeNodeSpec,
  type SystemTree,
  type SystemTreeBranch,
  type SystemTreeInspector,
  type SystemTreeNode,
  type SystemTreeOptions,
  type TreeNodeRuntimeIndicator,
} from "./system-tree-types.js";
import {
  isTreeNodeDescendantOrSelf,
  joinTreeNodePath,
  normalizeTreeNodePath,
  treeNodeLastSegment,
  treeNodeParentPath,
  treeNodePathSegments,
  type TreeNodePath,
  type TreeNodeRef,
} from "./tree-path.js";

type TreeSnapshotView = {
  readonly takenAt: string;
  readonly actors: readonly StoredActor[];
  readonly envelopes: readonly StoredEnvelope[];
};

function getActorPresentation<R extends ActorRegistry>(definitions: ActorDefinitionMap<R>, actor: StoredActor): ActorPresentation | undefined {
  const definition = definitions[actor.kind as KindOf<R>];
  return definition?.present?.({
    id: ActorId.parse(actor.id),
    kind: actor.kind as KindOf<R>,
    status: actor.status,
    behavior: actor.behavior as never,
    state: cloneJson(actor.state as never) as never,
    generation: actor.generation,
    version: actor.version,
  });
}

function toTreePath(path: TreeNodeRef | ActorId | string | undefined): TreeNodePath {
  if (!path) return "/" as TreeNodePath;
  if (typeof path === "string") return normalizeTreeNodePath(path);
  if (path instanceof ActorId) return normalizeTreeNodePath(path.toString());
  return path.path;
}

function toActorPath(actor: StoredActor): TreeNodePath {
  return normalizeTreeNodePath(actor.id);
}

function isIncluded(actor: StoredActor, includeStopped: boolean | undefined): boolean {
  return includeStopped === true || actor.status !== ActorStatus.Stopped;
}

function titleFromPath(path: TreeNodePath): string {
  const segment = treeNodeLastSegment(path);
  return segment === "/" ? "System" : segment;
}

function sortNodes(nodes: readonly SystemTreeNode[]): readonly SystemTreeNode[] {
  return [...nodes].sort((left, right) => {
    const leftKey = left.sortKey ?? left.title ?? left.path;
    const rightKey = right.sortKey ?? right.title ?? right.path;
    return leftKey.localeCompare(rightKey) || left.path.localeCompare(right.path);
  });
}

function makeRootNode(rootActors: readonly StoredActor[]): SystemTreeNode {
  return {
    path: "/" as TreeNodePath,
    nodeType: SystemTreeNodeType.Root,
    title: "System",
    hasChildren: rootActors.length > 0,
    childCount: rootActors.length,
  };
}

function hasNestedErrorState(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return entry.type === "error" || hasNestedErrorState(entry.result) || hasNestedErrorState(entry.error);
}

function deriveRuntimeIndicator(actor: StoredActor, envelopes: readonly StoredEnvelope[], overlay?: RealTreeNodeSpec): TreeNodeRuntimeIndicator | undefined {
  const mailbox = envelopes.filter((envelope) => envelope.to === actor.id);
  const hasFaultedWork = mailbox.some((envelope) => envelope.status === EnvelopeStatus.Faulted || envelope.status === EnvelopeStatus.DeadLettered);
  const hasBusyMailbox = mailbox.some((envelope) => envelope.status === EnvelopeStatus.Queued || envelope.status === EnvelopeStatus.Processing);
  const latestRuntimeLooksFailed = hasNestedErrorState(actor.state);
  if (actor.status === ActorStatus.Suspended || hasFaultedWork || latestRuntimeLooksFailed) {
    return "error";
  }
  if (hasBusyMailbox) {
    return "busy";
  }
  return undefined;
}

function makeRealActorNode<R extends ActorRegistry>(definitions: ActorDefinitionMap<R>, actor: StoredActor, envelopes: readonly StoredEnvelope[], childCount: number, overlay?: RealTreeNodeSpec): SystemTreeNode {
  const presentation = getActorPresentation(definitions, actor);
  const path = toActorPath(actor);
  const runtimeIndicator = deriveRuntimeIndicator(actor, envelopes, overlay);
  return {
    path,
    nodeType: SystemTreeNodeType.RealActor,
    title: overlay?.title ?? presentation?.title ?? treeNodeLastSegment(path),
    subtitle: overlay?.subtitle ?? presentation?.subtitle,
    icon: overlay?.icon ?? presentation?.icon,
    tags: overlay?.tags ?? presentation?.tags,
    sortKey: overlay?.sortKey ?? presentation?.sortKey,
    status: actor.status,
    ownerActorId: actor.id,
    actorId: actor.id,
    actorKind: actor.kind,
    behavior: actor.behavior,
    generation: actor.generation,
    version: actor.version,
    hasChildren: overlay?.hasChildren ?? childCount > 0,
    childCount: overlay?.childCount ?? childCount,
    ...(runtimeIndicator === undefined ? {} : { runtimeIndicator }),
    ...(overlay?.summary === undefined ? {} : { summary: overlay.summary }),
    presentation,
  };
}

export class LocalSystemTreeInspector<R extends ActorRegistry> implements SystemTreeInspector<R> {
  constructor(
    private readonly persistence: ActorPersistence,
    private readonly definitions: ActorDefinitionMap<R>,
    private readonly presentations: ActorTreePresentationMap<R>,
    private readonly clock: () => Date,
  ) {}

  async inspectTree(options?: SystemTreeOptions): Promise<SystemTree> {
    const rootPath = toTreePath(options?.root);
    const snapshot = await this.persistence.readSnapshot();
    const rootNode = await this.inspectNodeFromSnapshot(snapshot, rootPath, options?.includeStopped);
    if (!rootNode) throw new Error(`Tree node not found: ${rootPath}`);
    const maxDepth = options?.maxDepth ?? 8;
    const build = async (node: SystemTreeNode, depth: number): Promise<SystemTreeBranch> => {
      if (depth >= maxDepth || !node.hasChildren) return { node, children: [] };
      const children = this.realChildrenAtPath(snapshot.actors.filter((actor) => isIncluded(actor, options?.includeStopped)), node.path)
        .map((actor) => this.realActorNodeFromActors(snapshot.actors.filter((entry) => isIncluded(entry, options?.includeStopped)), snapshot, actor));
      return { node, children: await Promise.all(children.map((child) => build(child, depth + 1))) };
    };
    return { takenAt: snapshot.takenAt, root: await build(rootNode, 0) };
  }

  async inspectNode(path: TreeNodeRef | ActorId | string): Promise<SystemTreeNode | undefined> {
    const snapshot = await this.persistence.readSnapshot();
    return this.inspectNodeFromSnapshot(snapshot, toTreePath(path), undefined);
  }

  private async inspectNodeFromSnapshot(snapshot: TreeSnapshotView, nodePath: TreeNodePath, includeStopped: boolean | undefined): Promise<SystemTreeNode | undefined> {
    const visibleActors = snapshot.actors.filter((actor) => isIncluded(actor, includeStopped));
    if (nodePath === "/") return makeRootNode(this.realChildrenAtPath(visibleActors, nodePath));
    const realActor = visibleActors.find((actor) => toActorPath(actor) === nodePath);
    if (realActor) {
      const realChildren = this.realChildrenAtPath(visibleActors, nodePath);
      const described = await this.describeRealActor(realActor, nodePath);
      return makeRealActorNode(this.definitions, realActor, snapshot.envelopes, realChildren.length, described);
    }
    return undefined;
  }

  private realActorNodeFromActors(visibleActors: readonly StoredActor[], snapshot: TreeSnapshotView, actor: StoredActor): SystemTreeNode {
    return makeRealActorNode(this.definitions, actor, snapshot.envelopes, this.realChildrenAtPath(visibleActors, toActorPath(actor)).length);
  }

  private realChildrenAtPath(actors: readonly StoredActor[], parentPath: TreeNodePath): readonly StoredActor[] {
    return actors.filter((actor) => treeNodeParentPath(toActorPath(actor)) === parentPath);
  }

  private async describeRealActor(actor: StoredActor, nodePath: TreeNodePath): Promise<RealTreeNodeSpec | undefined> {
    const presentation = this.presentations[actor.kind as Extract<keyof R, string>];
    return presentation?.describeSelf?.({
      self: { id: ActorId.parse(actor.id), kind: actor.kind as KindOf<R> } as ActorRef<R, KindOf<R>>,
      status: actor.status,
      behavior: actor.behavior as never,
      state: cloneJson(actor.state as never) as never,
      generation: actor.generation,
      version: actor.version,
      nodePath,
      now: this.clock(),
    } as ActorTreeInspectionInput<R, KindOf<R>>);
  }
}

export function createSystemTreeInspector<R extends ActorRegistry>(options: CreateSystemTreeInspectorOptions<R>): SystemTreeInspector<R> {
  return new LocalSystemTreeInspector(options.persistence, options.definitions, options.presentations ?? {}, () => (options.clock ?? systemClock).now());
}