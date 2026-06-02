import { describe, expect, it } from "vitest";
import { ActorId, InMemoryActorPersistence, actorType, createActorSystem, defineRegistry } from "../src/index.js";

const ActorKind = { Counter: "counter" } as const;
const Behavior = { Active: "active" } as const;

const registry = defineRegistry({
  [ActorKind.Counter]: actorType<{ readonly value: number }, { readonly type: "noop" }, { readonly initial: number }, typeof Behavior.Active, never>(),
});

describe("introspection", () => {
  it("returns snapshot and hierarchy", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init(input) {
            return { state: { value: input.initial }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active]() {},
          },
          present(input) {
            return { title: `Counter ${input.state.value}` };
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });
    await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await system.runUntilIdle();
    const snapshot = await system.inspector.getSnapshot({ includeRuntime: true });
    expect(snapshot.actors).toHaveLength(1);
    const hierarchy = await system.inspector.getHierarchy({ includePresentation: true });
    expect(hierarchy.roots).toHaveLength(1);
  });
});