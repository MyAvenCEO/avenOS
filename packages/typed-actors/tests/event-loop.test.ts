import { describe, expect, it } from "vitest";
import { ActorId, InMemoryActorPersistence, actorType, createActorSystem, defineRegistry } from "../src/index.js";
import { ActorSystemError, PersistenceConflictError } from "../src/core/errors.js";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const ActorKind = { Counter: "counter" } as const;
const Behavior = { Active: "active" } as const;
const MessageType = { Increment: "counter.increment" } as const;

const registry = defineRegistry({
  [ActorKind.Counter]: actorType<
    { readonly value: number },
    { readonly type: typeof MessageType.Increment; readonly by: number },
    { readonly initial: number },
    typeof Behavior.Active,
    never
  >(),
});

describe("event loop", () => {
  it("runOne processes at most one envelope", async () => {
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

    const ref = await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Increment, by: 1 });
    await system.send(ref, { type: MessageType.Increment, by: 2 });

    const first = await system.runOne();
    expect(first.processed).toBe(true);
    const detailAfterFirst = await system.inspector.getActor(ActorId.root("counter"));
    expect(detailAfterFirst?.actor.state).toEqual({ value: 1 });

    await system.runUntilIdle();
    const finalDetail = await system.inspector.getActor(ActorId.root("counter"));
    expect(finalDetail?.actor.state).toEqual({ value: 3 });
  });

  it("runOne removes active claim when commitActivation throws", async () => {
    class ConflictOnCommitPersistence extends InMemoryActorPersistence {
      override async commitActivation(): Promise<void> {
        throw new PersistenceConflictError("PersistenceConflict", "boom");
      }
    }

    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init(input) {
            return { state: { value: input.initial }, behavior: Behavior.Active };
          },
          receive: { [Behavior.Active]() {} },
        },
      },
      persistence: new ConflictOnCommitPersistence(),
    });

    await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await expect(system.runOne()).rejects.toBeInstanceOf(PersistenceConflictError);
    expect(system.eventLoop.getRuntimeSnapshot().activeClaims).toHaveLength(0);
  });

  it("scheduler wake does not exceed configured concurrency and stop clears timers", async () => {
    const { startScheduler } = await import("../src/runtime/event-loop/scheduler.js");
    let running = 0;
    let peak = 0;
    let resolveCurrent!: () => void;
    const blocker = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    const scheduler = startScheduler(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await blocker;
      running -= 1;
      return true;
    }, {
      idleBackoffMs: 10,
      concurrency: 1,
      onError() {},
    });
    await sleep(5);
    scheduler.wake();
    scheduler.wake();
    await sleep(5);
    expect(peak).toBe(1);
    scheduler.stop();
    resolveCurrent();
    await sleep(0);
  });

  it("scheduler reports callback errors instead of creating unhandled rejections", async () => {
    const { startScheduler } = await import("../src/runtime/event-loop/scheduler.js");
    const errors: unknown[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    try {
      const scheduler = startScheduler(async () => {
        throw new Error("boom");
      }, {
        idleBackoffMs: 10,
        concurrency: 1,
        onError(error) {
          errors.push(error);
        },
      });

      await sleep(5);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]).toBeInstanceOf(Error);
      expect(unhandled).toEqual([]);

      scheduler.stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("does not create a second scheduler after a callback error and resume does not restart a failed loop", async () => {
    class ConflictOnCommitPersistence extends InMemoryActorPersistence {
      enabled = false;

      override async commitActivation(): Promise<void> {
        if (!this.enabled) {
          return super.commitActivation(...arguments as unknown as Parameters<InMemoryActorPersistence["commitActivation"]>);
        }
        throw new PersistenceConflictError("PersistenceConflict", "boom");
      }
    }

    const persistence = new ConflictOnCommitPersistence();
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init(input) {
            return { state: { value: input.initial }, behavior: Behavior.Active };
          },
          receive: { [Behavior.Active]() {} },
        },
      },
      persistence,
    });

    const ref = await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Increment, by: 1 });
    persistence.enabled = true;

    system.start();
    await sleep(20);

    const failedSnapshot = system.eventLoop.getRuntimeSnapshot();
    expect(failedSnapshot.running).toBe(false);
    expect(failedSnapshot.paused).toBe(true);
    expect(failedSnapshot.lastError?.message).toContain("boom");

    system.start();
    system.resume();
    await sleep(20);

    const finalSnapshot = system.eventLoop.getRuntimeSnapshot();
    expect(finalSnapshot.running).toBe(false);
    expect(finalSnapshot.paused).toBe(true);
  });

  it("concurrent stop calls resolve successfully", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init(input) {
            return { state: { value: input.initial }, behavior: Behavior.Active };
          },
          receive: {
            async [Behavior.Active](ctx, message) {
              await sleep(5);
              ctx.setState({ value: ctx.state.value + message.by });
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const ref = await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Increment, by: 1 });

    const [first, second, third] = await Promise.all([
      system.stop(),
      system.stop(),
      system.stop(),
    ]);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(third).toBeUndefined();

    const detail = await system.inspector.getActor(ActorId.root("counter"));
    expect(detail?.actor.status).toBe("stopped");
  });

  it("send and createRoot reject after shutdown begins", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init(input) {
            return { state: { value: input.initial }, behavior: Behavior.Active };
          },
          receive: {
            async [Behavior.Active](ctx, message) {
              await sleep(10);
              ctx.setState({ value: ctx.state.value + message.by });
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const ref = await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Increment, by: 1 });

    const stopping = system.stop();

    const sendDuringStop = async (): Promise<void> => {
      await system.send(ref, { type: MessageType.Increment, by: 1 });
    };
    const createRootDuringStop = async (): Promise<void> => {
      await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter-2"), init: { initial: 0 } });
    };

    await expect(sendDuringStop).rejects.toBeInstanceOf(ActorSystemError);
    await expect(createRootDuringStop).rejects.toBeInstanceOf(ActorSystemError);

    await stopping;
  });

  it("runOne and runUntilIdle do not process normal user work after stop starts", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init(input) {
            return { state: { value: input.initial }, behavior: Behavior.Active };
          },
          receive: {
            async [Behavior.Active](ctx, message) {
              await sleep(5);
              ctx.setState({ value: ctx.state.value + message.by });
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const ref = await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Increment, by: 1 });

    const stopping = system.stop();
    const runOneResult = await system.runOne();
    const idleResult = await system.runUntilIdle();

    expect(runOneResult.processed).toBe(false);
    expect(idleResult.processed).toBe(0);

    await stopping;

    const detail = await system.inspector.getActor(ActorId.root("counter"));
    expect(detail?.actor.status).toBe("stopped");
    expect(detail?.actor.state).toEqual({ value: 0 });
  });
});