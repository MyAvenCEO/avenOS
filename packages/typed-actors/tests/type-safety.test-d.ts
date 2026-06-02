import { actorType, defineRegistry } from "../src/registry/define-registry.js";
import type { ActorDefinition } from "../src/registry/actor-definition.js";

const ActorKind = { Counter: "counter", Parent: "parent" } as const;
const Behavior = { Active: "active" } as const;
const Msg = { Increment: "counter.increment" } as const;

type CounterMessage = { readonly type: typeof Msg.Increment; readonly by: number };

const registry = defineRegistry({
  [ActorKind.Counter]: actorType<{ readonly value: number }, CounterMessage, { readonly initial: number }, typeof Behavior.Active, never>(),
  [ActorKind.Parent]: actorType<{ readonly ready: boolean }, { readonly type: "parent.start" }, {}, typeof Behavior.Active, typeof ActorKind.Counter>(),
});

type AppRegistry = typeof registry;

const _definition: ActorDefinition<AppRegistry, typeof ActorKind.Parent> = {
  kind: ActorKind.Parent,
  init() {
    return { state: { ready: true }, behavior: Behavior.Active };
  },
  receive: {
    [Behavior.Active](ctx) {
      const child = ctx.spawn(ActorKind.Counter, { id: ctx.self.id.child("child"), init: { initial: 0 } });
      ctx.send(child, { type: Msg.Increment, by: 1 });
      // @ts-expect-error
      ctx.become("waitingish");
      // @ts-expect-error
      ctx.spawn(ActorKind.Parent, { id: ctx.self.id.child("bad"), init: {} });
      // @ts-expect-error
      ctx.send(child, { type: "wrong" });
    },
  },
};

export {};