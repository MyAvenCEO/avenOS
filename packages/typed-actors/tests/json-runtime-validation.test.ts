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
import { InvalidJsonValueError } from "../src/core/errors.js";

const ActorKind = { Parent: "parent", Child: "child" } as const;
const Behavior = { Active: "active" } as const;
const MessageType = { Spawn: "spawn", Fail: "fail" } as const;

const registry = defineRegistry({
  [ActorKind.Parent]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, typeof ActorKind.Child>(),
  [ActorKind.Child]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, never>(),
});

function createParentSystem(definitions: Parameters<typeof createActorSystem<typeof registry>>[0]["definitions"]) {
  const persistence = new InMemoryActorPersistence();
  const system = createActorSystem({ registry, definitions, persistence });
  return { system, persistence };
}

describe("runtime JSON validation", () => {
  it("createRoot rejects non-JSON init", async () => {
    const { system, persistence } = createParentSystem({
      [ActorKind.Parent]: { kind: ActorKind.Parent, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
      [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
    });

    await expect(system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: new Map() as never })).rejects.toBeInstanceOf(InvalidJsonValueError);
    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true });
    expect(snapshot.actors).toHaveLength(0);
    expect(snapshot.envelopes).toHaveLength(0);
  });

  it("createRoot rejects non-JSON state returned by init", async () => {
    const { system, persistence } = createParentSystem({
      [ActorKind.Parent]: { kind: ActorKind.Parent, init: () => ({ state: new Date() as never, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
      [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
    });

    await expect(system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} })).rejects.toBeInstanceOf(InvalidJsonValueError);
    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true });
    expect(snapshot.actors).toHaveLength(0);
    expect(snapshot.envelopes).toHaveLength(0);
  });

  it("spawn rejects non-JSON init", async () => {
    const { system, persistence } = createParentSystem({
      [ActorKind.Parent]: {
        kind: ActorKind.Parent,
        init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active](ctx, message) {
            if (message.type === MessageType.Spawn) {
              ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: new Set() as never });
            }
          },
        },
      },
      [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
    });

    const ref = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Spawn });
    await system.runUntilIdle();

    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true, includeDroppedEnvelopes: true });
    expect(snapshot.actors.some((actor) => actor.id === "/parent/child")).toBe(false);
    const parent = await system.inspector.getActor(ActorId.root("parent"));
    expect(parent?.actor.status).toBe(ActorStatus.Stopped);
  });

  it("spawn rejects non-JSON state returned by child init", async () => {
    const { system, persistence } = createParentSystem({
      [ActorKind.Parent]: {
        kind: ActorKind.Parent,
        init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active](ctx, message) {
            if (message.type === MessageType.Spawn) {
              ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
            }
          },
        },
      },
      [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: undefined as never, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
    });

    const ref = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(ref, { type: MessageType.Spawn });
    await system.runUntilIdle();

    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true, includeDroppedEnvelopes: true });
    expect(snapshot.actors.some((actor) => actor.id === "/parent/child")).toBe(false);
    const parent = await system.inspector.getActor(ActorId.root("parent"));
    expect(parent?.actor.status).toBe(ActorStatus.Stopped);
  });

  it("restart rejects non-JSON state returned by init", async () => {
    let childInitCalls = 0;
    const { system, persistence } = createParentSystem({
      [ActorKind.Parent]: {
        kind: ActorKind.Parent,
        init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active](ctx, message) {
            if (message.type === MessageType.Spawn) {
              ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
            }
          },
        },
        supervise() {
          return { type: "restart", failedMessage: "drop" } as const;
        },
      },
      [ActorKind.Child]: {
        kind: ActorKind.Child,
        init: () => {
          childInitCalls += 1;
          return childInitCalls === 1
            ? { state: { value: 0 }, behavior: Behavior.Active }
            : { state: (() => undefined)() as never, behavior: Behavior.Active };
        },
        receive: {
          [Behavior.Active](ctx, message) {
            if (message.type === MessageType.Fail) {
              throw new Error("boom");
            }
            if (message.type === MessageType.Spawn) {
              ctx.stop({ type: StopReasonType.Requested });
            }
          },
        },
      },
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.Spawn });
    await system.runUntilIdle();
    const childRef = { id: ActorId.parse("/parent/child"), kind: ActorKind.Child } as const;
    await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true, includeDroppedEnvelopes: true });
    const child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const restartEnvelope = snapshot.envelopes.find((envelope) => envelope.kind === "lifecycle.restart");
    const parentDetail = await system.inspector.getActor(ActorId.root("parent"));

    expect(child?.generation).toBe(0);
    expect(restartEnvelope).toBeUndefined();
    expect(parentDetail?.actor.status).toBe(ActorStatus.Stopped);
  });
});