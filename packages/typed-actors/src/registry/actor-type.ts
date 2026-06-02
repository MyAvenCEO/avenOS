export interface ActorMessage<TType extends string = string> {
  readonly type: TType;
}

export interface AnyMessage extends ActorMessage<string> {
  readonly type: string;
}

export interface ActorType<
  TState,
  TInbox extends AnyMessage,
  TInit,
  TBehavior extends string,
  TChildKind extends string,
> {
  readonly __state?: TState;
  readonly __inbox?: TInbox;
  readonly __init?: TInit;
  readonly __behavior?: TBehavior;
  readonly __children?: TChildKind;
}

export type AnyActorType = ActorType<unknown, AnyMessage, unknown, string, string>;
export type ActorRegistry = Readonly<Record<string, AnyActorType>>;
export type KindOf<R extends ActorRegistry> = Extract<keyof R, string>;

export type StateOf<R extends ActorRegistry, K extends KindOf<R>> =
  R[K] extends ActorType<infer TState, AnyMessage, unknown, string, string>
    ? TState
    : never;

export type InboxOf<R extends ActorRegistry, K extends KindOf<R>> =
  R[K] extends ActorType<unknown, infer TInbox, unknown, string, string>
    ? TInbox
    : never;

export type InitOf<R extends ActorRegistry, K extends KindOf<R>> =
  R[K] extends ActorType<unknown, AnyMessage, infer TInit, string, string>
    ? TInit
    : never;

export type BehaviorOf<R extends ActorRegistry, K extends KindOf<R>> =
  R[K] extends ActorType<unknown, AnyMessage, unknown, infer TBehavior, string>
    ? TBehavior
    : never;

export type ChildrenOf<R extends ActorRegistry, K extends KindOf<R>> =
  R[K] extends ActorType<unknown, AnyMessage, unknown, string, infer TChildKind>
    ? Extract<TChildKind, KindOf<R>>
    : never;

export function actorType<
  TState,
  TInbox extends AnyMessage,
  TInit,
  TBehavior extends string,
  TChildKind extends string = never,
>(): ActorType<TState, TInbox, TInit, TBehavior, TChildKind> {
  return {} as ActorType<TState, TInbox, TInit, TBehavior, TChildKind>;
}