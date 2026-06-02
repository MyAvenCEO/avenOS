import type { ActorId } from "../core/actor-id.js";
import type { CausationId, CorrelationId, DedupeKey } from "../core/ids.js";
import type { ActorRegistry, InitOf, KindOf } from "../registry/actor-type.js";

export interface SendOptions {
  readonly notBefore?: Date;
  readonly priority?: number;
  readonly correlationId?: CorrelationId;
  readonly causationId?: CausationId;
  readonly dedupeKey?: DedupeKey;
  readonly maxAttempts?: number;
}

export interface SpawnOptions<R extends ActorRegistry, K extends KindOf<R>> {
  readonly id: ActorId;
  readonly init: InitOf<R, K>;
}

export interface RequiredSendOptions {
  readonly notBefore: Date;
  readonly priority: number;
  readonly correlationId?: CorrelationId;
  readonly causationId?: CausationId;
  readonly dedupeKey?: DedupeKey;
  readonly maxAttempts: number;
}