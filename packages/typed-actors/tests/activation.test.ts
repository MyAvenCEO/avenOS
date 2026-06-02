import { describe, expect, it } from "vitest";
import { ActorId, InMemoryActorPersistence, actorType, createActorSystem, defineRegistry } from "../src/index.js";

const ActorKind = { Counter: "counter" } as const;
const MessageType = { Increment: "counter.increment" } as const;
const Behavior = { Active: "active" } as const;

type CounterState = { readonly value: number };
type CounterInit = { readonly initial: number };
type CounterMessage = { readonly type: typeof MessageType.Increment; readonly by: number };

const registry = defineRegistry({
  [ActorKind.Counter]: actorType<CounterState, CounterMessage, CounterInit, typeof Behavior.Active, never>(),
});

describe("activation", () => {
  it("updates state after processing a message", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init(input) {
            return { state: { value: input.initial }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              ctx.setState({ value: ctx.state.value + message.by });
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });
    const ref = await system.createRoot(ActorKind.Counter, {
      id: ActorId.root("counter"),
      init: { initial: 1 },
    });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Increment, by: 2 });
    await system.runUntilIdle();
    const detail = await system.inspector.getActor(ActorId.root("counter"));
    expect(detail?.actor.state).toEqual({ value: 3 });
  });
});