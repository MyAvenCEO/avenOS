import { ActorId } from "../core/actor-id.js";
import type { ActorDefinitionMap, ActorPresentation } from "../registry/actor-definition.js";
import type { ActorRegistry, KindOf } from "../registry/actor-type.js";
import type { StoredActor } from "../persistence/stored-records.js";

export function getActorPresentation<R extends ActorRegistry>(
  definitions: ActorDefinitionMap<R>,
  actor: StoredActor,
): ActorPresentation | undefined {
  const definition = definitions[actor.kind as KindOf<R>];
  if (!definition) {
    return undefined;
  }
  if (!definition.present) {
    return undefined;
  }
  return definition.present({
    id: ActorId.parse(actor.id),
    kind: actor.kind as KindOf<R>,
    status: actor.status,
    behavior: actor.behavior as never,
    state: actor.state as never,
    generation: actor.generation,
    version: actor.version,
  });
}