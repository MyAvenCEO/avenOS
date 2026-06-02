import { ActorId } from "typed-actors";
import type { ActorAddress } from "./actor-address.ts";

/**
 * Address used by a request sender to declare where correlated completions must be sent.
 */
export interface ReplyAddress<K extends string = string> extends ActorAddress<K> {}

/**
 * Converts a runtime actor id and kind into a runtime-agnostic reply address contract.
 */
export function toReplyAddress<K extends string>(actorId: ActorId, actorKind: K): ReplyAddress<K> {
  return { actorId: actorId.toString(), actorKind };
}
