import { describe, expect, it } from "vitest";
import {
  ActorId,
  ActorStatus,
  EnvelopeKind,
  EnvelopeStatus,
  FailedMessageAction,
  InMemoryActorPersistence,
  SupervisionDirectiveType,
  actorType,
  createActorSystem,
  defineRegistry,
} from "../src/index.js";

const ActorKind = {
  Grandparent: "grandparent",
  Parent: "parent",
  Child: "child",
  Root: "root",
} as const;

const Behavior = { Active: "active" } as const;
const MessageType = {
  SpawnParent: "spawnParent",
  SpawnChild: "spawnChild",
  Fail: "fail",
} as const;

const registry = defineRegistry({
  [ActorKind.Grandparent]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, typeof ActorKind.Parent>(),
  [ActorKind.Parent]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, typeof ActorKind.Child>(),
  [ActorKind.Child]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, never>(),
  [ActorKind.Root]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, typeof ActorKind.Child>(),
});

async function setupParentChildSystem(options: {
  readonly parentDirective?: { readonly type: string; readonly failedMessage?: string; readonly backoffMs?: number };
  readonly childAlwaysFails?: boolean;
  readonly runtime?: Parameters<typeof createActorSystem<typeof registry>>[0]["runtime"];
}) {
  const persistence = new InMemoryActorPersistence();
  const system = createActorSystem({
    registry,
    runtime: options.runtime,
    definitions: {
      [ActorKind.Parent]: {
        kind: ActorKind.Parent,
        init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active](ctx, message) {
            if (message.type === MessageType.SpawnChild) {
              ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
            }
          },
        },
        ...(options.parentDirective ? { supervise: () => options.parentDirective as never } : {}),
      },
      [ActorKind.Child]: {
        kind: ActorKind.Child,
        init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active]() {
            if (options.childAlwaysFails ?? true) {
              throw new Error("boom");
            }
          },
        },
      },
      [ActorKind.Grandparent]: {
        kind: ActorKind.Grandparent,
        init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
        receive: { [Behavior.Active]() {} },
      },
      [ActorKind.Root]: {
        kind: ActorKind.Root,
        init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
        receive: {
          [Behavior.Active](ctx, message) {
            if (message.type === MessageType.SpawnChild) {
              ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
            }
            if (message.type === MessageType.Fail) {
              throw new Error("boom");
            }
          },
        },
      },
    },
    persistence,
  });

  const parent = await system.createRoot(ActorKind.Parent, { id: ActorId.root("parent"), init: {} });
  await system.runUntilIdle();
  await system.send(parent, { type: MessageType.SpawnChild });
  await system.runUntilIdle();
  const childRef = { id: ActorId.parse("/parent/child"), kind: ActorKind.Child } as const;
  return { system, persistence, parent, childRef };
}

async function snapshotFor(persistence: InMemoryActorPersistence) {
  return persistence.readSnapshot({ includeCompletedEnvelopes: true, includeDroppedEnvelopes: true, includeEvents: true });
}

describe("supervision matrix", () => {
  it("resume/retry restores child to running and requeues faulted message with incremented attempt and backoff", async () => {
    const { system, persistence, childRef } = await setupParentChildSystem({
      parentDirective: { type: SupervisionDirectiveType.Resume, failedMessage: FailedMessageAction.Retry, backoffMs: 25 },
    });
    const envelopeId = await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    const snapshot = await snapshotFor(persistence);
    const child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const failedEnvelope = snapshot.envelopes.find((envelope) => envelope.id === envelopeId);
    expect(child?.status).toBe(ActorStatus.Running);
    expect(failedEnvelope?.status).toBe(EnvelopeStatus.Queued);
    expect(failedEnvelope?.attempt).toBe(1);
    expect(failedEnvelope?.notBefore).not.toBe(failedEnvelope?.createdAt);
  });

  it("restart/drop reinitializes child state, increments generation, and queues lifecycle.restart", async () => {
    const { system, persistence, childRef } = await setupParentChildSystem({
      parentDirective: { type: SupervisionDirectiveType.Restart, failedMessage: FailedMessageAction.Drop },
    });
    const envelopeId = await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    const snapshot = await snapshotFor(persistence);
    const child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const failedEnvelope = snapshot.envelopes.find((envelope) => envelope.id === envelopeId);
    const restartEnvelope = snapshot.envelopes.find((envelope) => envelope.kind === EnvelopeKind.LifecycleRestart && envelope.to === childRef.id.toString());

    expect(child?.status).toBe(ActorStatus.Starting);
    expect(child?.generation).toBe(1);
    expect(child?.state).toEqual({ value: 0 });
    expect(restartEnvelope?.status).toBe(EnvelopeStatus.Queued);
    expect(failedEnvelope?.status).toBe(EnvelopeStatus.Dropped);
  });

  it("restart/retry reinitializes child and requeues faulted message", async () => {
    const { system, persistence, childRef } = await setupParentChildSystem({
      parentDirective: { type: SupervisionDirectiveType.Restart, failedMessage: FailedMessageAction.Retry },
    });
    const envelopeId = await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    const snapshot = await snapshotFor(persistence);
    const child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const failedEnvelope = snapshot.envelopes.find((envelope) => envelope.id === envelopeId);
    const restartEnvelope = snapshot.envelopes.find((envelope) => envelope.kind === EnvelopeKind.LifecycleRestart && envelope.to === childRef.id.toString());

    expect(child?.status).toBe(ActorStatus.Starting);
    expect(child?.generation).toBe(1);
    expect(restartEnvelope?.status).toBe(EnvelopeStatus.Queued);
    expect(failedEnvelope?.status).toBe(EnvelopeStatus.Queued);
  });

  it("stop/deadLetter transitions child to stopping then stopped and deadLetters failed envelope", async () => {
    const { system, persistence, childRef } = await setupParentChildSystem({
      parentDirective: { type: SupervisionDirectiveType.Stop, failedMessage: FailedMessageAction.DeadLetter },
    });
    const envelopeId = await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    let snapshot = await snapshotFor(persistence);
    let child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const failedEnvelope = snapshot.envelopes.find((envelope) => envelope.id === envelopeId);
    const stopEnvelope = snapshot.envelopes.find((envelope) => envelope.kind === EnvelopeKind.LifecycleStop && envelope.to === childRef.id.toString());
    expect(child?.status).toBe(ActorStatus.Stopping);
    expect(stopEnvelope?.status).toBe(EnvelopeStatus.Queued);
    expect(failedEnvelope?.status).toBe(EnvelopeStatus.DeadLettered);

    await system.runOne();
    snapshot = await snapshotFor(persistence);
    child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    expect(child?.status).toBe(ActorStatus.Stopped);
  });

  it("stop/drop transitions child to stopping then stopped and drops failed envelope", async () => {
    const { system, persistence, childRef } = await setupParentChildSystem({
      parentDirective: { type: SupervisionDirectiveType.Stop, failedMessage: FailedMessageAction.Drop },
    });
    const envelopeId = await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    let snapshot = await snapshotFor(persistence);
    let child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const failedEnvelope = snapshot.envelopes.find((envelope) => envelope.id === envelopeId);
    expect(child?.status).toBe(ActorStatus.Stopping);
    expect(failedEnvelope?.status).toBe(EnvelopeStatus.Dropped);

    await system.runOne();
    snapshot = await snapshotFor(persistence);
    child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    expect(child?.status).toBe(ActorStatus.Stopped);
  });

  it("escalate causes parent activation failure and propagates failure to grandparent", async () => {
    const persistence = new InMemoryActorPersistence();
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Grandparent]: {
          kind: ActorKind.Grandparent,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.SpawnParent) {
                ctx.spawn(ActorKind.Parent, { id: ctx.self.id.child("parent"), init: {} });
              }
            },
          },
          supervise() {
            return { type: SupervisionDirectiveType.Resume, failedMessage: FailedMessageAction.Drop };
          },
        },
        [ActorKind.Parent]: {
          kind: ActorKind.Parent,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.SpawnChild) {
                ctx.spawn(ActorKind.Child, { id: ctx.self.id.child("child"), init: {} });
              }
            },
          },
          supervise() {
            return { type: SupervisionDirectiveType.Escalate };
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: { [Behavior.Active]() { throw new Error("boom"); } },
        },
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: { [Behavior.Active]() {} },
        },
      },
      persistence,
    });

    const root = await system.createRoot(ActorKind.Grandparent, { id: ActorId.root("grandparent"), init: {} });
    await system.runUntilIdle();
    await system.send(root, { type: MessageType.SpawnParent });
    await system.runUntilIdle();
    const parentRef = { id: ActorId.parse("/grandparent/parent"), kind: ActorKind.Parent } as const;
    await system.send(parentRef, { type: MessageType.SpawnChild });
    await system.runUntilIdle();
    const childRef = { id: ActorId.parse("/grandparent/parent/child"), kind: ActorKind.Child } as const;

    await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    const snapshot = await snapshotFor(persistence);
    const parent = snapshot.actors.find((actor) => actor.id === parentRef.id.toString());
    const propagated = snapshot.envelopes.find((envelope) => {
      return envelope.kind === EnvelopeKind.Supervision && envelope.to === root.id.toString();
    });
    expect(parent?.status).toBe(ActorStatus.Suspended);
    expect(propagated?.status).toBe(EnvelopeStatus.Queued);
  });

  it("default policy stops and deadLetters after maxRestarts within window", async () => {
    const { system, persistence, childRef } = await setupParentChildSystem({
      runtime: { supervision: { maxRestarts: 1, windowMs: 60_000, retryBackoffMs: 0 } },
    });

    await system.send(childRef, { type: MessageType.Fail });
    await system.runUntilIdle();
    await system.send(childRef, { type: MessageType.Fail });
    const secondEnvelopeId = await system.send(childRef, { type: MessageType.Fail });
    await system.runOne();
    await system.runOne();

    const snapshot = await snapshotFor(persistence);
    const child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const failedEnvelope = snapshot.envelopes.find((envelope) => envelope.id === secondEnvelopeId);
    expect(child?.status).toBe(ActorStatus.Stopped);
    expect(failedEnvelope?.status).toBe(EnvelopeStatus.DeadLettered);
  });

  it("default policy deadLetters immediately when the failed envelope has exhausted maxAttempts", async () => {
    const { system, persistence, childRef } = await setupParentChildSystem({
      runtime: { supervision: { maxRestarts: 10, windowMs: 60_000, retryBackoffMs: 0 } },
    });

    const envelopeId = await system.send(childRef, { type: MessageType.Fail }, { maxAttempts: 1 });
    await system.runOne();
    await system.runOne();

    const snapshot = await snapshotFor(persistence);
    const child = snapshot.actors.find((actor) => actor.id === childRef.id.toString());
    const failedEnvelope = snapshot.envelopes.find((envelope) => envelope.id === envelopeId);
    expect(child?.status).toBe(ActorStatus.Stopping);
    expect(failedEnvelope?.status).toBe(EnvelopeStatus.DeadLettered);
    expect(failedEnvelope?.attempt).toBe(1);
  });

  it("unsupervised root actor failure becomes stopped and deadLettered", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active]() {
              throw new Error("boom");
            },
          },
        },
        [ActorKind.Child]: { kind: ActorKind.Child, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Parent]: { kind: ActorKind.Parent, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
        [ActorKind.Grandparent]: { kind: ActorKind.Grandparent, init: () => ({ state: { value: 0 }, behavior: Behavior.Active }), receive: { [Behavior.Active]() {} } },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const root = await system.createRoot(ActorKind.Root, { id: ActorId.root("root"), init: {} });
    await system.runUntilIdle();
    await system.send(root, { type: MessageType.Fail });
    await system.runUntilIdle();

    const actor = await system.inspector.getActor(ActorId.root("root"));
    expect(actor?.actor.status).toBe(ActorStatus.Stopped);
    expect(actor?.mailbox.deadLettered?.some((envelope) => envelope.messageType === MessageType.Fail)).toBe(true);
  });
});