import type { ActorStatus } from "../core/constants.js";
import type { ActorId } from "../core/actor-id.js";
import type {
  ActorRegistry,
  BehaviorOf,
  InboxOf,
  InitOf,
  KindOf,
  StateOf,
} from "./actor-type.js";
import type { ActorContext } from "../runtime/activation/actor-context.js";
import type { RestartReason, StopReason } from "../runtime/lifecycle/lifecycle-types.js";
import type { ActorFailure, SupervisionDirective } from "../runtime/supervision/supervision-types.js";

export type Awaitable<T> = T | Promise<T>;

export interface InitResult<R extends ActorRegistry, K extends KindOf<R>> {
  readonly state: StateOf<R, K>;
  readonly behavior: BehaviorOf<R, K>;
}

export type ActorReceiver<R extends ActorRegistry, K extends KindOf<R>> = (
  ctx: ActorContext<R, K>,
  message: InboxOf<R, K>,
) => Awaitable<void>;

export type LifecycleHook<R extends ActorRegistry, K extends KindOf<R>> = (
  ctx: ActorContext<R, K>,
) => Awaitable<void>;

export type StopHook<R extends ActorRegistry, K extends KindOf<R>> = (
  ctx: ActorContext<R, K>,
  reason: StopReason,
) => Awaitable<void>;

export type RestartHook<R extends ActorRegistry, K extends KindOf<R>> = (
  ctx: ActorContext<R, K>,
  reason: RestartReason,
) => Awaitable<void>;

export type SupervisionHook<R extends ActorRegistry, K extends KindOf<R>> = (
  ctx: ActorContext<R, K>,
  failure: ActorFailure,
) => Awaitable<SupervisionDirective>;

export interface ActorPresentation {
  readonly title?: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly tags?: readonly string[];
  readonly sortKey?: string;
}

export interface ActorPresentationInput<R extends ActorRegistry, K extends KindOf<R>> {
  readonly id: ActorId;
  readonly kind: K;
  readonly status: ActorStatus;
  readonly behavior: BehaviorOf<R, K>;
  readonly state: Readonly<StateOf<R, K>>;
  readonly generation: number;
  readonly version: number;
}

export type ActorPresentationHook<R extends ActorRegistry, K extends KindOf<R>> = (
  input: ActorPresentationInput<R, K>,
) => ActorPresentation;

export interface ActorDefinition<R extends ActorRegistry, K extends KindOf<R>> {
  readonly kind: K;
  init(input: InitOf<R, K>): InitResult<R, K>;
  readonly isMessage?: (value: unknown) => value is InboxOf<R, K>;
  readonly receive: {
    readonly [B in BehaviorOf<R, K>]: ActorReceiver<R, K>;
  };
  readonly onStart?: LifecycleHook<R, K>;
  readonly onStop?: StopHook<R, K>;
  readonly onRestart?: RestartHook<R, K>;
  readonly supervise?: SupervisionHook<R, K>;
  readonly present?: ActorPresentationHook<R, K>;
}

export interface ActorModule<R extends ActorRegistry, K extends KindOf<R>> extends ActorDefinition<R, K> {}

export type ActorDefinitionMap<R extends ActorRegistry> = Readonly<Record<KindOf<R>, ActorDefinition<R, any>>>;
