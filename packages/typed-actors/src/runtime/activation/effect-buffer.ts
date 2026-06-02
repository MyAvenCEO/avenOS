import type { ActorId } from "../../core/actor-id.js";
import type { ActorRef } from "../../core/actor-ref.js";
import type {
  ValueOf,
} from "../../core/constants.js";
import type {
  ActorRegistry,
  BehaviorOf,
  ChildrenOf,
  InboxOf,
  InitOf,
  KindOf,
  StateOf,
} from "../../registry/actor-type.js";
import type { StopReason } from "../lifecycle/lifecycle-types.js";
import type { RequiredSendOptions } from "../../messaging/send-options.js";

export const EffectType = {
  Send: "send",
  Spawn: "spawn",
  SetState: "setState",
  Become: "become",
  StopSelf: "stopSelf",
  StopChild: "stopChild",
} as const;

export type EffectType = ValueOf<typeof EffectType>;

export interface SendEffect<R extends ActorRegistry> {
  readonly type: typeof EffectType.Send;
  readonly to: ActorRef<R, KindOf<R>>;
  readonly message: InboxOf<R, KindOf<R>>;
  readonly options: RequiredSendOptions;
}

export interface SpawnEffect<R extends ActorRegistry, K extends KindOf<R>> {
  readonly type: typeof EffectType.Spawn;
  readonly parent: ActorRef<R, K>;
  readonly childKind: ChildrenOf<R, K>;
  readonly childId: ActorId;
  readonly init: InitOf<R, ChildrenOf<R, K>>;
}

export interface StateEffect<R extends ActorRegistry, K extends KindOf<R>> {
  readonly type: typeof EffectType.SetState;
  readonly state: StateOf<R, K>;
}

export interface BecomeEffect<R extends ActorRegistry, K extends KindOf<R>> {
  readonly type: typeof EffectType.Become;
  readonly behavior: BehaviorOf<R, K>;
  readonly state?: StateOf<R, K>;
}

export interface StopSelfEffect {
  readonly type: typeof EffectType.StopSelf;
  readonly reason: StopReason;
}

export interface StopChildEffect {
  readonly type: typeof EffectType.StopChild;
  readonly childId: ActorId;
  readonly reason: StopReason;
}

export type Effect<R extends ActorRegistry, K extends KindOf<R>> =
  | SendEffect<R>
  | SpawnEffect<R, K>
  | StateEffect<R, K>
  | BecomeEffect<R, K>
  | StopSelfEffect
  | StopChildEffect;

export class EffectBuffer<R extends ActorRegistry, K extends KindOf<R>> {
  private readonly effects: Effect<R, K>[] = [];
  private closed = false;

  close(): void {
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("Activation effect buffer is closed");
    }
  }

  add(effect: Effect<R, K>): void {
    this.ensureOpen();
    this.effects.push(effect);
  }

  all(): readonly Effect<R, K>[] {
    this.ensureOpen();
    return this.effects.slice();
  }
}