import { describe, expect, it } from "vitest";
import {
  ActorId,
  ActorStatus,
  FailedMessageAction,
  InMemoryActorPersistence,
  SupervisionDirectiveType,
  actorType,
  createActorSystem,
  defineRegistry,
} from "../src/index.js";

const ActorKind = {
  Parent: "parent",
  Child: "child",
} as const;

const Behavior = { Active: "active" } as const;
const MessageType = {
  SpawnChild: "parent.spawnChild",
  Fail: "child.fail",
} as const;

type ParentMessage = { readonly type: typeof MessageType.SpawnChild };
type ChildMessage = { readonly type: typeof MessageType.Fail };

const registry = defineRegistry({
  [ActorKind.Parent]: actorType<{ readonly ready: boolean }, ParentMessage, {}, typeof Behavior.Active, typeof ActorKind.Child>(),
  [ActorKind.Child]: actorType<{ readonly value: number }, ChildMessage, {}, typeof Behavior.Active, never>(),
});

describe("supervision", () => {
  it("resume/drop restores child to running and drops faulted message", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init() {
            return { state: { ready: true }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active](ctx) {
              ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
            },
          },
          supervise() {
            return {
              type: SupervisionDirectiveType.Resume,
              failedMessage: FailedMessageAction.Drop,
            };
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init() {
            return { state: { value: 0 }, behavior: Behavior.Active };
          },
          receive: {
            [Behavior.Active]() {
              throw new Error("boom");
            },
          },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
    await system.runUntilIdle();
    await system.send(parent, { type: MessageType.SpawnChild });
    await system.runUntilIdle();

    const childRef = { id: ActorId.parse("/parent/child"), kind: ActorKind.Child } as const;
    await system.send(childRef, { type: MessageType.Fail });
    await system.runUntilIdle();

    const child = await system.inspector.getActor(ActorId.parse("/parent/child"));
    expect(child?.actor.status).toBe(ActorStatus.Running);
    expect(child?.mailbox.dropped?.length).toBeGreaterThanOrEqual(1);
  });
});