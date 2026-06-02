import type { ActorId } from "./actor-id.js";
import type { ActorRegistry, KindOf } from "../registry/actor-type.js";

export interface ActorRef<
  R extends ActorRegistry,
  K extends KindOf<R>,
> {
  readonly id: ActorId;
  readonly kind: K;
}

export function actorRef<R extends ActorRegistry, K extends KindOf<R>>(
  id: ActorId,
  kind: K,
): ActorRef<R, K> {
  return { id, kind };
}