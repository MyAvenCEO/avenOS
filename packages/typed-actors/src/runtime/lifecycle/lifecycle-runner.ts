import { ActorStatus } from "../../core/constants.js";
import type { ActorDefinition } from "../../registry/actor-definition.js";
import type { ActorRegistry, KindOf } from "../../registry/actor-type.js";
import type { ActorContext } from "../activation/actor-context.js";
import type { RestartReason, StopReason } from "./lifecycle-types.js";

export async function runOnStart<R extends ActorRegistry, K extends KindOf<R>>(
  definition: ActorDefinition<R, K>,
  ctx: ActorContext<R, K>,
): Promise<ActorStatus> {
  if (definition.onStart) {
    await definition.onStart(ctx);
  }
  return ActorStatus.Running;
}

export async function runOnStop<R extends ActorRegistry, K extends KindOf<R>>(
  definition: ActorDefinition<R, K>,
  ctx: ActorContext<R, K>,
  reason: StopReason,
): Promise<ActorStatus> {
  if (definition.onStop) {
    await definition.onStop(ctx, reason);
  }
  return ActorStatus.Stopped;
}

export async function runOnRestart<R extends ActorRegistry, K extends KindOf<R>>(
  definition: ActorDefinition<R, K>,
  ctx: ActorContext<R, K>,
  reason: RestartReason,
): Promise<ActorStatus> {
  if (definition.onRestart) {
    await definition.onRestart(ctx, reason);
  }
  return ActorStatus.Running;
}