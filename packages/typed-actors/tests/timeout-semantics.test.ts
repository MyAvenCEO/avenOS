import { afterEach, describe, expect, it } from "vitest";
import {
  ActorId,
  ActorStatus,
  InMemoryActorPersistence,
  actorType,
  createActorSystem,
  defineRegistry,
} from "../src/index.js";

const ActorKind = { Slow: "slow" } as const;
const Behavior = { Active: "active" } as const;
const MessageType = { Ping: "ping", LateBoom: "lateBoom", LateSend: "lateSend", LateSetState: "lateSetState" } as const;

const registry = defineRegistry({
  [ActorKind.Slow]: actorType<
    { readonly done: boolean },
    { readonly type: string },
    {},
    typeof Behavior.Active,
    never
  >(),
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  process.removeAllListeners("unhandledRejection");
});

describe("activation timeout semantics", () => {
  it("activation timeout does not leave unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const system = createActorSystem({
      registry,
      runtime: { activationTimeoutMs: 5, leaseMs: 100 },
      definitions: {
        [ActorKind.Slow]: {
          kind: ActorKind.Slow,
          init: () => ({ state: { done: false }, behavior: Behavior.Active }),
          receive: {
            async [Behavior.Active](_ctx, message) {
              if (message.type === MessageType.LateBoom) {
                await delay(20);
                throw new Error("late boom");
              }
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const ref = await system.createRoot(ActorKind.Slow, { id: ActorId.root("slow"), init: {} });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.LateBoom });
    await system.runUntilIdle();
    await delay(30);

    expect(unhandled).toEqual([]);
    const actor = await system.inspector.getActor(ActorId.root("slow"));
    expect(actor?.actor.status).toBe(ActorStatus.Stopped);
  });

  it("ctx.send after timeout does not enqueue anything", async () => {
    const persistence = new InMemoryActorPersistence();
    const system = createActorSystem({
      registry,
      runtime: { activationTimeoutMs: 5, leaseMs: 100 },
      definitions: {
        [ActorKind.Slow]: {
          kind: ActorKind.Slow,
          init: () => ({ state: { done: false }, behavior: Behavior.Active }),
          receive: {
            async [Behavior.Active](ctx, message) {
              if (message.type === MessageType.LateSend) {
                try {
                  await new Promise<void>((_resolve, reject) => {
                    ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
                  });
                } catch {
                  await delay(0);
                  try {
                    ctx.send(ctx.self, { type: MessageType.Ping } as never);
                  } catch {
                    // ignore late send after timeout
                  }
                }
              }
            },
          },
        },
      },
      persistence,
    });

    const ref = await system.createRoot(ActorKind.Slow, { id: ActorId.root("slow"), init: {} });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.LateSend });
    await system.runUntilIdle();
    await delay(10);

    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true, includeDroppedEnvelopes: true });
    const userEnvelopes = snapshot.envelopes.filter((envelope) => {
      return envelope.to === ref.id.toString() && envelope.kind === "user";
    });
    expect(userEnvelopes).toHaveLength(1);
  });

  it("ctx.setState after timeout does not persist anything", async () => {
    const system = createActorSystem({
      registry,
      runtime: { activationTimeoutMs: 5, leaseMs: 100 },
      definitions: {
        [ActorKind.Slow]: {
          kind: ActorKind.Slow,
          init: () => ({ state: { done: false }, behavior: Behavior.Active }),
          receive: {
            async [Behavior.Active](ctx, message) {
              if (message.type === MessageType.LateSetState) {
                try {
                  await new Promise<void>((_resolve, reject) => {
                    ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
                  });
                } catch {
                  await delay(0);
                  try {
                    ctx.setState({ done: true });
                  } catch {
                    // ignore late state update after timeout
                  }
                }
              }
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const ref = await system.createRoot(ActorKind.Slow, { id: ActorId.root("slow"), init: {} });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.LateSetState });
    await system.runUntilIdle();
    await delay(10);

    const actor = await system.inspector.getActor(ActorId.root("slow"));
    expect(actor?.actor.state).toEqual({ done: false });
    expect(actor?.actor.status).toBe(ActorStatus.Stopped);
  });
});