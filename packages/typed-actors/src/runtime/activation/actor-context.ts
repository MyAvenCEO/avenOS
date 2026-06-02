import { ActorStatus, StopReasonType } from "../../core/constants.js";
import type { ActorRef } from "../../core/actor-ref.js";
import { assertJsonValue, cloneJson } from "../../core/json.js";
import type { EnvelopeView } from "../../messaging/envelope.js";
import type { SendOptions, SpawnOptions } from "../../messaging/send-options.js";
import type {
  ActorRegistry,
  BehaviorOf,
  ChildrenOf,
  InboxOf,
  KindOf,
  StateOf,
} from "../../registry/actor-type.js";
import type { StopReason } from "../lifecycle/lifecycle-types.js";
import { EffectBuffer, EffectType } from "./effect-buffer.js";

export interface ActorContext<R extends ActorRegistry, K extends KindOf<R>> {
  readonly self: ActorRef<R, K>;
  readonly parent: ActorRef<R, KindOf<R>> | undefined;
  readonly sender: ActorRef<R, KindOf<R>> | undefined;
  readonly state: Readonly<StateOf<R, K>>;
  readonly behavior: BehaviorOf<R, K>;
  readonly envelope: EnvelopeView;
  readonly now: Date;
  readonly signal: AbortSignal;
  send<TTarget extends KindOf<R>>(to: ActorRef<R, TTarget>, message: InboxOf<R, TTarget>, options?: SendOptions): void;
  spawn<TChild extends ChildrenOf<R, K>>(kind: TChild, options: SpawnOptions<R, TChild>): ActorRef<R, TChild>;
  setState(state: StateOf<R, K>): void;
  become(behavior: BehaviorOf<R, K>, state?: StateOf<R, K>): void;
  stop(reason?: StopReason): void;
  stopChild<TChild extends ChildrenOf<R, K>>(child: ActorRef<R, TChild>, reason?: StopReason): void;
}

export interface CreateActorContextInput<R extends ActorRegistry, K extends KindOf<R>> {
  readonly self: ActorRef<R, K>;
  readonly parent: ActorRef<R, KindOf<R>> | undefined;
  readonly sender: ActorRef<R, KindOf<R>> | undefined;
  readonly actorStatus: ActorStatus;
  readonly state: StateOf<R, K>;
  readonly behavior: BehaviorOf<R, K>;
  readonly envelope: EnvelopeView;
  readonly now: Date;
  readonly signal: AbortSignal;
  readonly effects: EffectBuffer<R, K>;
  readonly defaultMessageMaxAttempts: number;
}

export function createActorContext<R extends ActorRegistry, K extends KindOf<R>>(
  input: CreateActorContextInput<R, K>,
): ActorContext<R, K> {
  let stopRequested = input.actorStatus === "stopping" || input.actorStatus === "stopped";

  return {
    self: input.self,
    parent: input.parent,
    sender: input.sender,
    state: cloneJson(input.state as never) as Readonly<StateOf<R, K>>,
    behavior: input.behavior,
    envelope: input.envelope,
    now: new Date(input.now.getTime()),
    signal: input.signal,
    send(to, message, options) {
      if (stopRequested) {
        return;
      }
      assertJsonValue(message);
      input.effects.add({
        type: EffectType.Send,
        to: to as ActorRef<R, KindOf<R>>,
        message: cloneJson(message as never) as InboxOf<R, KindOf<R>>,
        options: {
          notBefore: options?.notBefore ?? input.now,
          priority: options?.priority ?? 0,
          correlationId: options?.correlationId ?? input.envelope.correlationId,
          causationId: options?.causationId ?? input.envelope.id,
          dedupeKey: options?.dedupeKey,
          maxAttempts: options?.maxAttempts ?? input.defaultMessageMaxAttempts,
        },
      });
    },
    spawn(kind, options) {
      if (stopRequested) {
        throw new Error(`Cannot spawn child ${String(kind)} from stopping actor ${input.self.id.toString()}`);
      }
      assertJsonValue(options.init);
      input.effects.add({
        type: EffectType.Spawn,
        parent: input.self,
        childKind: kind,
        childId: options.id,
        init: cloneJson(options.init as never),
      });
      return { id: options.id, kind };
    },
    setState(state) {
      assertJsonValue(state);
      input.effects.add({ type: EffectType.SetState, state: cloneJson(state as never) });
    },
    become(behavior, state) {
      if (state !== undefined) {
        assertJsonValue(state);
      }
      input.effects.add({
        type: EffectType.Become,
        behavior,
        state: state === undefined ? undefined : cloneJson(state as never),
      });
    },
    stop(reason = { type: StopReasonType.Requested }) {
      stopRequested = true;
      input.effects.add({ type: EffectType.StopSelf, reason });
    },
    stopChild(child, reason = { type: StopReasonType.Requested }) {
      input.effects.add({ type: EffectType.StopChild, childId: child.id, reason });
    },
  };
}