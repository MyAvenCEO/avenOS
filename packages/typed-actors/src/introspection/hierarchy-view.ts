import { ActorStatus } from "../core/constants.js";
import type { IsoDateTimeString } from "../core/ids.js";
import type { ActorDefinitionMap } from "../registry/actor-definition.js";
import type { ActorRegistry } from "../registry/actor-type.js";
import type { StoredActor } from "../persistence/stored-records.js";
import type { ActorHierarchy, ActorHierarchyNode, HierarchyOptions } from "./actor-inspector.js";
import { getActorPresentation } from "./presentation.js";

export function buildActorHierarchy<R extends ActorRegistry>(
  actors: readonly StoredActor[],
  definitions: ActorDefinitionMap<R>,
  takenAt: IsoDateTimeString,
  options?: HierarchyOptions,
): ActorHierarchy {
  const childrenByParent = new Map<string | undefined, StoredActor[]>();
  for (const actor of actors) {
    const group = childrenByParent.get(actor.parentId) ?? [];
    group.push(actor);
    childrenByParent.set(actor.parentId, group);
  }

  const includedIds = new Set<string>();
  const rootFilter = options?.rootId?.toString();
  if (!rootFilter) {
    for (const actor of actors) {
      includedIds.add(actor.id);
    }
  } else {
    const queue = [rootFilter];
    while (queue.length > 0) {
      const current = queue.shift()!;
      includedIds.add(current);
      for (const child of childrenByParent.get(current) ?? []) {
        if (!includedIds.has(child.id)) {
          queue.push(child.id);
        }
      }
    }
  }

  const filtered = actors.filter((actor) => {
    if (!options?.includeStopped && actor.status === ActorStatus.Stopped) {
      return false;
    }
    return includedIds.has(actor.id);
  });
  const byParent = new Map<string | undefined, StoredActor[]>();
  for (const actor of filtered) {
    const group = byParent.get(actor.parentId) ?? [];
    group.push(actor);
    byParent.set(actor.parentId, group);
  }
  const toNode = (actor: StoredActor): ActorHierarchyNode => ({
    id: actor.id,
    kind: actor.kind,
    status: actor.status,
    behavior: actor.behavior,
    generation: actor.generation,
    version: actor.version,
    presentation: options?.includePresentation ? getActorPresentation(definitions, actor) : undefined,
    children: (byParent.get(actor.id) ?? []).map(toNode),
  });
  return {
    takenAt,
    roots: options?.rootId
      ? filtered.filter((actor) => actor.id === options.rootId!.toString()).map(toNode)
      : (byParent.get(undefined) ?? []).map(toNode),
  };
}