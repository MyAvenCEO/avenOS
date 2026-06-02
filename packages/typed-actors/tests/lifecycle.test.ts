import { describe, expect, it } from "vitest";
import {
  ActorId,
  ActorStatus,
  InMemoryActorPersistence,
  StopReasonType,
  actorType,
  createActorSystem,
  defineRegistry,
} from "../src/index.js";
import type { ActorContext } from "../src/index.js";

const ActorKind = {
  Parent: "parent",
  Child: "child",
} as const;

const Behavior = {
  Active: "active",
} as const;

const MessageType = {
  Start: "parent.start",
  Stop: "parent.stop",
  StopChild: "parent.stopChild",
  PingChild: "parent.pingChild",
} as const;

type ParentMessage =
  | { readonly type: typeof MessageType.Start }
  | { readonly type: typeof MessageType.Stop }
  | { readonly type: typeof MessageType.StopChild }
  | { readonly type: typeof MessageType.PingChild };

type ChildMessage = { readonly type: "child.noop" };

type ChildState = {
  readonly seenStops: number;
  readonly seenMessages?: number;
};

const registry = defineRegistry({
  [ActorKind.Parent]: actorType<
    { readonly started: boolean },
    ParentMessage,
    {},
    typeof Behavior.Active,
    typeof ActorKind.Child
  >(),
  [ActorKind.Child]: actorType<
    ChildState,
    ChildMessage,
    {},
    typeof Behavior.Active,
    never
  >(),
});

describe("lifecycle", () => {
  it("runs onStart and moves actor to running", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          onStart(ctx) {
            ctx.setState({ started: true });
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0 }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();

    const detail = await system.inspector.getActor(ActorId.root("parent"));
    expect(detail?.actor.status).toBe(ActorStatus.Running);
    expect(detail?.actor.state).toEqual({ started: true });
  });

  it("stop cascades to direct children", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
              }
              if (message.type === MessageType.Stop) {
                ctx.stop({ type: StopReasonType.Requested });
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0 }, behavior: Behavior.Active };
          },
          onStop(ctx) {
            ctx.setState({ seenStops: ctx.state.seenStops + 1 });
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Stop });
    await system.runUntilIdle();

    const parentDetail = await system.inspector.getActor(ActorId.root("parent"));
    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(parentDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.state).toEqual({ seenStops: 1 });
  });

  it("still stops direct children when parent onStop throws during shutdown", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          onStop() {
            throw new Error("parent stop failed");
          },
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0 }, behavior: Behavior.Active };
          },
          onStop(ctx) {
            ctx.setState({ seenStops: ctx.state.seenStops + 1 });
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();

    await system.stop();

    const parentDetail = await system.inspector.getActor(ActorId.root("parent"));
    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(parentDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.state).toEqual({ seenStops: 1 });
  });

  it("parent stop prevents child from handling later user messages", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              const child = { id: ctx.self.id.child("child"), kind: ActorKind.Child } as const;
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: child.id, init: {} });
              }
              if (message.type === MessageType.PingChild) {
                ctx.send(child, { type: "child.noop" });
              }
              if (message.type === MessageType.Stop) {
                ctx.stop({ type: StopReasonType.Requested });
                ctx.send(child, { type: "child.noop" });
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0, seenMessages: 0 }, behavior: Behavior.Active };
          },
          onStop(ctx: ActorContext<typeof registry, typeof ActorKind.Child>) {
            ctx.setState({ ...ctx.state, seenStops: ctx.state.seenStops + 1 });
          },
          receive: {
            [Behavior.Active](ctx: ActorContext<typeof registry, typeof ActorKind.Child>) {
              ctx.setState({
                ...ctx.state,
                seenMessages: (ctx.state.seenMessages ?? 0) + 1,
              });
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Stop });
    await system.runUntilIdle();

    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(childDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.state).toEqual({ seenStops: 1, seenMessages: 0 });
  });

  it("queued child user message is skipped once parent stop commits", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              const child = { id: ctx.self.id.child("child"), kind: ActorKind.Child } as const;
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: child.id, init: {} });
              }
              if (message.type === MessageType.PingChild) {
                ctx.send(child, { type: "child.noop" });
              }
              if (message.type === MessageType.Stop) {
                ctx.stop();
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0, seenMessages: 0 }, behavior: Behavior.Active };
          },
          onStop(ctx: ActorContext<typeof registry, typeof ActorKind.Child>) {
            ctx.setState({ ...ctx.state, seenStops: ctx.state.seenStops + 1 });
          },
          receive: {
            [Behavior.Active](ctx: ActorContext<typeof registry, typeof ActorKind.Child>) {
              ctx.setState({ ...ctx.state, seenMessages: (ctx.state.seenMessages ?? 0) + 1 });
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.PingChild });
    await system.send(parent, { type: MessageType.Stop });
    await system.runUntilIdle();

    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(childDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.state).toEqual({ seenStops: 1, seenMessages: 0 });
    expect(childDetail?.mailbox.deadLettered?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("onStop spawn is rejected and no live child remains", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          onStop(ctx) {
            expect(() => ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("late-child"), init: {} })).toThrow();
          },
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Stop) {
                ctx.stop();
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0 }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Stop });
    await system.runUntilIdle();

    const lateChild = await system.inspector.getActor(ActorId.parse("/parent/late-child"));
    expect(lateChild).toBeUndefined();
  });

  it("child onStop failure during parent shutdown ends stopped", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0 }, behavior: Behavior.Active };
          },
          onStop() {
            throw new Error("child stop failed");
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();

    await system.stop();

    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(childDetail?.actor.status).toBe(ActorStatus.Stopped);
  });

  it("already-stopping actors are drained by system.stop", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              const child = { id: ctx.self.id.child("child"), kind: ActorKind.Child } as const;
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: child.id, init: {} });
              }
              if (message.type === MessageType.StopChild) {
                ctx.stopChild(child);
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0 }, behavior: Behavior.Active };
          },
          onStop(ctx) {
            ctx.setState({ seenStops: ctx.state.seenStops + 1 });
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.StopChild });

    await system.stop();

    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(childDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.state).toEqual({ seenStops: 1 });
  });

  it("lifecycle stop priority beats queued normal messages", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              const child = { id: ctx.self.id.child("child"), kind: ActorKind.Child } as const;
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: child.id, init: {} });
              }
              if (message.type === MessageType.PingChild) {
                ctx.send(child, { type: "child.noop" }, { priority: -100 });
              }
              if (message.type === MessageType.Stop) {
                ctx.stop();
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0, seenMessages: 0 }, behavior: Behavior.Active };
          },
          onStop(ctx: ActorContext<typeof registry, typeof ActorKind.Child>) {
            ctx.setState({ ...ctx.state, seenStops: ctx.state.seenStops + 1 });
          },
          receive: {
            [Behavior.Active](ctx: ActorContext<typeof registry, typeof ActorKind.Child>) {
              ctx.setState({ ...ctx.state, seenMessages: (ctx.state.seenMessages ?? 0) + 1 });
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.PingChild });
    await system.send(parent, { type: MessageType.Stop });
    await system.runUntilIdle();

    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(childDetail?.actor.state).toEqual({ seenStops: 1, seenMessages: 0 });
  });

  it("stopChild is idempotent", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { started: false }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Start) {
                ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
              }
              if (message.type === MessageType.StopChild) {
                const child = { id: ctx.self.id.child("child"), kind: ActorKind.Child } as const;
                ctx.stopChild(child);
                ctx.stopChild(child);
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { seenStops: 0 }, behavior: Behavior.Active };
          },
          onStop(ctx) {
            ctx.setState({ seenStops: ctx.state.seenStops + 1 });
          },
          receive: {
            [Behavior.Active]() {},
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Start });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.StopChild });
    await system.runUntilIdle();

    const childDetail = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(childDetail?.actor.status).toBe(ActorStatus.Stopped);
    expect(childDetail?.actor.state).toEqual({ seenStops: 1 });
  });
});