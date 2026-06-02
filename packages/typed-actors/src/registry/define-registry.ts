import type { ActorDefinition, ActorModule } from "./actor-definition.js";
import type { ActorRegistry, KindOf } from "./actor-type.js";
export { actorType } from "./actor-type.js";

export function defineRegistry<const R extends ActorRegistry>(registry: R): R {
  return registry;
}

export function defineActor<R extends ActorRegistry, K extends KindOf<R>>(
  definition: ActorDefinition<R, K> | ActorModule<R, K>,
): ActorDefinition<R, K> {
  return definition;
}