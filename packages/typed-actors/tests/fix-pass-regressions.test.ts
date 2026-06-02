import { describe, expect, it, vi } from "vitest";
import {
  ActorErrorCode,
  ActorId,
  ActorStatus,
  EnvelopeKind,
  EnvelopeStatus,
  FailedMessageAction,
  InMemoryActorPersistence,
  RuntimeEventType,
  StopReasonType,
  SupervisionDirectiveType,
  actorType,
  createActorSystem,
  defineRegistry,
} from "../src/index.js";
import { PersistenceConflictError } from "../src/core/errors.js";
import { defaultIdGenerator, toIsoDateTimeString } from "../src/core/ids.js";

const ActorKind = {
  Root: "root",
  Child: "child",
  Counter: "counter",
  Slow: "slow",
  Switcher: "switcher",
} as const;

const Behavior = {
  Active: "active",
  Waiting: "waiting",
} as const;

const MessageType = {
  Set: "set",
  Spawn: "spawn",
  Fail: "fail",
  Run: "run",
  Stop: "stop",
  Become: "become",
  Noop: "noop",
} as const;

const registry = defineRegistry({
  [ActorKind.Root]: actorType<{ readonly value: number | null | false | "" }, { readonly type: string; readonly value?: unknown }, {}, typeof Behavior.Active, typeof ActorKind.Child>(),
  [ActorKind.Child]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, never>(),
  [ActorKind.Counter]: actorType<number | null | false | "", { readonly type: string; readonly value?: unknown }, { readonly initial: number | null | false | "" }, typeof Behavior.Active, never>(),
  [ActorKind.Slow]: actorType<{ readonly done: boolean }, { readonly type: string }, {}, typeof Behavior.Active, never>(),
  [ActorKind.Switcher]: actorType<{ readonly mode: string }, { readonly type: string }, {}, typeof Behavior.Active | typeof Behavior.Waiting, never>(),
});

describe("fix pass regressions", () => {
  it("system.stop moves running root to stopping and finishes stop lifecycle", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init() {
            return { state: { value: 1 }, behavior: Behavior.Active };
          },
          onStop(ctx) {
            ctx.setState({ value: 2 });
          },
          receive: { [Behavior.Active]() {} },
        },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
    });

    await system.createRoot(ActorKind.Root, { id: ActorId.root("root"), init: {} });
    await system.runUntilIdle();
    await system.stop();

    const actor = await system.inspector.getActor(ActorId.root("root"));
    expect(actor?.actor.status).toBe(ActorStatus.Stopped);
    expect(actor?.actor.state).toEqual({ value: 2 });
  });

  it.each([
    { label: "null", value: null },
    { label: "false", value: false },
    { label: "0", value: 0 },
    { label: '""', value: "" },
  ])("persists falsy state $label", async ({ value }) => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init: (input) => ({ state: input.initial, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx, message) {
              ctx.setState(message.value as never);
            },
          },
        },
        [ActorKind.Root]: { kind: ActorKind.Root, init: () => ({ state: { value: null }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const ref = await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 1 } });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Set, value } as never);
    await system.runUntilIdle();

    const actor = await system.inspector.getActor(ActorId.root("counter"));
    expect(actor?.actor.state).toEqual(value);
  });

  it("enqueue rejects duplicate envelope id", async () => {
    const persistence = new InMemoryActorPersistence();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root");
    await persistence.createActor({
      actor: {
        id: actorId.toString(), kind: ActorKind.Root, status: ActorStatus.Running, behavior: Behavior.Active,
        state: { value: 0 }, init: {}, generation: 0, version: 0,
        createdAt: toIsoDateTimeString(now), updatedAt: toIsoDateTimeString(now),
      },
      startEnvelope: {
        id: defaultIdGenerator.envelopeId(), kind: EnvelopeKind.LifecycleStart, to: actorId.toString(), toKind: ActorKind.Root,
        message: { type: "system.lifecycle.start" }, status: EnvelopeStatus.Completed, attempt: 0, maxAttempts: 1,
        notBefore: toIsoDateTimeString(now), priority: 0, createdAt: toIsoDateTimeString(now), updatedAt: toIsoDateTimeString(now),
      },
      events: [],
      ifExists: "fail",
    });
    const id = defaultIdGenerator.envelopeId();
    const envelope = {
      id,
      kind: EnvelopeKind.User,
      to: actorId.toString(),
      toKind: ActorKind.Root,
      message: { type: MessageType.Noop },
      status: EnvelopeStatus.Queued,
      attempt: 0,
      maxAttempts: 1,
      notBefore: toIsoDateTimeString(now),
      priority: 0,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
    } as const;
    await persistence.enqueue([envelope]);
    await expect(persistence.enqueue([envelope])).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("invalid persisted message with validator fails activation as UnhandledMessage", async () => {
    const persistence = new InMemoryActorPersistence();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root");
    await persistence.createActor({
      actor: {
        id: actorId.toString(), kind: ActorKind.Root, status: ActorStatus.Running, behavior: Behavior.Active,
        state: { value: 0 }, init: {}, generation: 0, version: 0,
        createdAt: toIsoDateTimeString(now), updatedAt: toIsoDateTimeString(now),
      },
      startEnvelope: {
        id: defaultIdGenerator.envelopeId(), kind: EnvelopeKind.LifecycleStart, to: actorId.toString(), toKind: ActorKind.Root,
        message: { type: "system.lifecycle.start" }, status: EnvelopeStatus.Completed, attempt: 0, maxAttempts: 1,
        notBefore: toIsoDateTimeString(now), priority: 0, createdAt: toIsoDateTimeString(now), updatedAt: toIsoDateTimeString(now),
      },
      events: [],
      ifExists: "fail",
    });
    await persistence.enqueue([{
      id: defaultIdGenerator.envelopeId(), kind: EnvelopeKind.User, to: actorId.toString(), toKind: ActorKind.Root,
      message: { type: MessageType.Noop, bad: true }, status: EnvelopeStatus.Queued, attempt: 0, maxAttempts: 1,
      notBefore: toIsoDateTimeString(now), priority: 0, createdAt: toIsoDateTimeString(now), updatedAt: toIsoDateTimeString(now),
    }]);
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          isMessage: (value): value is { readonly type: string; readonly value?: unknown } => value != null && typeof value === "object" && (value as { type?: unknown }).type === MessageType.Set,
          receive: { [Behavior.Active]() {} },
        },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence,
    });

    await system.runUntilIdle();
    const actor = await system.inspector.getActor(actorId);
    expect(actor?.actor.status).toBe(ActorStatus.Stopped);
    expect(actor?.mailbox.deadLettered?.length ?? 0).toBeGreaterThan(0);
  });

  it("reports invalid external messages through the infrastructure sink", async () => {
    const events: Array<{ readonly type: string; readonly actorId?: string }> = [];
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          isMessage: (value): value is { readonly type: string; readonly value?: unknown } => value != null && typeof value === "object" && (value as { type?: unknown }).type === MessageType.Set,
          receive: { [Behavior.Active]() {} },
        },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
      runtime: { infrastructureLogSink: { emit(event) { events.push(event as never); } } },
    });

    const ref = await system.createRoot(ActorKind.Root, { id: ActorId.root("root"), init: {} });
    await system.runUntilIdle();
    await expect(system.send(ref, { type: MessageType.Noop } as never)).rejects.toThrow();
    expect(events.some((event) => event.type === "externalMessageRejected" && event.actorId === "/root")).toBe(true);
  });

  it("stable ids canonicalize object keys", () => {
    const root = ActorId.root("root");
    expect(root.stable("x", { a: 1, b: 2 }).toString()).toBe(root.stable("x", { b: 2, a: 1 }).toString());
  });

  it("actor id ancestor check is structural", () => {
    expect(ActorId.parse("/foo/bar").isAncestorOf(ActorId.parse("/foo/bar2"))).toBe(false);
  });

  it("actor id rejects invalid segments", () => {
    expect(() => ActorId.root("a/b")).toThrow();
    expect(() => ActorId.root("..")).toThrow();
    expect(() => ActorId.root(".")).toThrow();
  });

  it("become persists behavior across activations", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Switcher]: {
          kind: ActorKind.Switcher,
          init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx) {
              ctx.become(Behavior.Waiting, { mode: "waiting" });
            },
            [Behavior.Waiting]() {},
          },
        },
        [ActorKind.Root]: { kind: ActorKind.Root, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
    });
    const ref = await system.createRoot(ActorKind.Switcher, { id: ActorId.root("switcher"), init: {} });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Become } as never);
    await system.runUntilIdle();
    const actor = await system.inspector.getActor(ActorId.root("switcher"));
    expect(actor?.actor.behavior).toBe(Behavior.Waiting);
    expect(actor?.actor.state).toEqual({ mode: "waiting" });
  });

  it("root supervisor restarts failed child under default policy", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Spawn) {
                ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx) {
              if (ctx.envelope.attempt === 0) {
                throw new Error("boom");
              }
            },
          },
        },
        [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
    });
    const root = await system.createRoot(ActorKind.Root, { id: ActorId.root("root"), init: {} });
    await system.runUntilIdle();
    await system.send(root, { type: MessageType.Spawn });
    await system.runUntilIdle();
    await system.send({ id: ActorId.parse("/root/child"), kind: ActorKind.Child }, { type: MessageType.Fail } as never);
    await system.runUntilIdle();
    const child = await system.inspector.getActor(ActorId.parse("/root/child"));
    expect(child?.actor.status).toBe(ActorStatus.Running);
    expect(child?.actor.generation).toBe(1);
  });

  it("reports activation failures and supervision decisions through the infrastructure sink", async () => {
    const events: Array<{ readonly type: string; readonly childId?: string; readonly actorId?: string }> = [];
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Spawn) {
                ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active]() {
              throw new Error("boom");
            },
          },
        },
        [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
      runtime: { infrastructureLogSink: { emit(event) { events.push(event as never); } } },
    });

    const root = await system.createRoot(ActorKind.Root, { id: ActorId.root("root"), init: {} });
    await system.runUntilIdle();
    await system.send(root, { type: MessageType.Spawn });
    await system.runUntilIdle();
    await system.send({ id: ActorId.parse("/root/child"), kind: ActorKind.Child }, { type: MessageType.Fail } as never);
    await system.runUntilIdle();

    expect(events.some((event) => event.type === "activationFailed" && event.actorId === "/root/child")).toBe(true);
    expect(events.some((event) => event.type === "supervisionApplied" && event.childId === "/root/child")).toBe(true);
  });

  it("activation timeout fails activation and suspends actor", async () => {
    const system = createActorSystem({
      registry,
      runtime: { activationTimeoutMs: 10, leaseMs: 100 },
      definitions: {
        [ActorKind.Slow]: {
          kind: ActorKind.Slow,
          init: () => ({ state: { done: false }, behavior: Behavior.Active }),
          receive: {
            async [Behavior.Active](ctx) {
              await new Promise<void>((_resolve, reject) => {
                ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
              });
            },
          },
        },
        [ActorKind.Root]: { kind: ActorKind.Root, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
    });
    const ref = await system.createRoot(ActorKind.Slow, { id: ActorId.root("slow"), init: {} });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Noop } as never);
    await system.runUntilIdle();
    const actor = await system.inspector.getActor(ActorId.root("slow"));
    expect(actor?.actor.status).toBe(ActorStatus.Stopped);
  });

  it("idle scheduler uses backoff instead of tight polling", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { startScheduler } = await import("../src/runtime/event-loop/scheduler.js");
      const scheduler = startScheduler(async () => {
        calls += 1;
        return false;
      }, {
        idleBackoffMs: 50,
        concurrency: 1,
        onError() {},
      });
      await vi.advanceTimersByTimeAsync(1);
      const afterOneMs = calls;
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(afterOneMs);
      await vi.advanceTimersByTimeAsync(50);
      expect(calls).toBeGreaterThan(afterOneMs);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop waits for active activation before requesting root stop", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    try {
      let releaseHandler!: () => void;
      let handlerStarted!: () => void;

      const handlerStartedPromise = new Promise<void>((resolve) => {
        handlerStarted = resolve;
      });

      const handlerReleasePromise = new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });

      const persistence = new InMemoryActorPersistence();

      const system = createActorSystem({
        registry,
        definitions: {
          [ActorKind.Slow]: {
            kind: ActorKind.Slow,
            init() {
              return {
                state: { done: false },
                behavior: Behavior.Active,
              };
            },
            receive: {
              async [Behavior.Active](ctx) {
                handlerStarted();
                await handlerReleasePromise;
                ctx.setState({ done: true });
              },
            },
            onStop(ctx) {
              ctx.setState({ done: true });
            },
          },
          [ActorKind.Root]: { kind: ActorKind.Root, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
          [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
          [ActorKind.Counter]: { kind: ActorKind.Counter, init: (input) => ({ state: input.initial, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
          [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
        },
        persistence,
        runtime: {
          activationTimeoutMs: 10_000,
          leaseMs: 20_000,
        },
      });

      const ref = await system.createRoot(ActorKind.Slow, {
        id: ActorId.root("slow"),
        init: {},
      });

      await system.runUntilIdle();

      await system.send(ref, {
        type: MessageType.Run,
      } as never);

      system.start();

      await handlerStartedPromise;

      const stopPromise = system.stop();

      releaseHandler();

      await stopPromise;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(unhandled).toEqual([]);

      const snapshot = await system.inspector.getSnapshot({
        includeCompletedEnvelopes: true,
        includeDroppedEnvelopes: true,
        includeRuntime: true,
      });

      expect(snapshot.actors.find((actor) => actor.id === "/slow")?.status)
        .toBe(ActorStatus.Stopped);

      expect(snapshot.envelopes.some((envelope) => {
        return envelope.status === EnvelopeStatus.Processing;
      })).toBe(false);

      expect(snapshot.envelopes.some((envelope) => {
        return envelope.kind === EnvelopeKind.LifecycleStop &&
          envelope.status === EnvelopeStatus.Completed;
      })).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("captures scheduler errors in runtime snapshot and pauses automatic loop", async () => {
    class ConflictOnCommitPersistence extends InMemoryActorPersistence {
      failCommit = false;

      override async commitActivation(...args: Parameters<InMemoryActorPersistence["commitActivation"]>): Promise<void> {
        if (this.failCommit) {
          throw new PersistenceConflictError("PersistenceConflict", "boom");
        }

        return super.commitActivation(...args);
      }
    }

    const persistence = new ConflictOnCommitPersistence();
    const events: Array<{ readonly type: string; readonly error?: { readonly message?: string } }> = [];
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Counter]: {
          kind: ActorKind.Counter,
          init: (input) => ({ state: input.initial, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active]() {},
          },
        },
        [ActorKind.Root]: { kind: ActorKind.Root, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Slow]: { kind: ActorKind.Slow, init: () => ({ state: { done: false }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Switcher]: { kind: ActorKind.Switcher, init: () => ({ state: { mode: "active" }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {}, [Behavior.Waiting]() {} } },
      },
      persistence,
      runtime: { infrastructureLogSink: { emit(event) { events.push(event as never); } } },
    });

    const ref = await system.createRoot(ActorKind.Counter, { id: ActorId.root("counter"), init: { initial: 0 } });
    await system.runUntilIdle();
    persistence.failCommit = true;
    await system.send(ref, { type: MessageType.Noop } as never);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    try {
      system.start();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const runtime = system.eventLoop.getRuntimeSnapshot();
      expect(unhandled).toEqual([]);
      expect(runtime.paused).toBe(true);
      expect(runtime.lastError?.name).toBe("PersistenceConflictError");
      expect(runtime.lastError?.message).toBe("boom");
      expect(events.some((event) => event.type === "schedulerFailed" && event.error?.message === "boom")).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      persistence.failCommit = false;
      await system.stop();
    }
  });
});