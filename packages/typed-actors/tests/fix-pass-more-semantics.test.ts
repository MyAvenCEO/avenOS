import { describe, expect, it } from "vitest";
import {
  ActorErrorCode,
  ActorId,
  ActorStatus,
  EnvelopeKind,
  EnvelopeStatus,
  InMemoryActorPersistence,
  RuntimeEventType,
  StopReasonType,
  actorType,
  createActorSystem,
  defineRegistry,
} from "../src/index.js";
import { PersistenceConflictError } from "../src/core/errors.js";
import { defaultIdGenerator, toIsoDateTimeString } from "../src/core/ids.js";
import { ActorCreateMode } from "../src/persistence/actor-persistence.js";

const ActorKind = {
  Root: "root",
  Child: "child",
} as const;

const Behavior = { Active: "active" } as const;
const MessageType = {
  Spawn: "spawn",
  Fail: "fail",
  Stop: "stop",
  Ping: "ping",
} as const;

const registry = defineRegistry({
  [ActorKind.Root]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, typeof ActorKind.Child>(),
  [ActorKind.Child]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, never>(),
});

describe("fix pass additional semantics", () => {
  it("commit conflict does not become actor failure", async () => {
    class ConflictOnCommitPersistence extends InMemoryActorPersistence {
      override async commitActivation(): Promise<void> {
        throw new PersistenceConflictError(ActorErrorCode.PersistenceConflict, "boom");
      }
    }

    const persistence = new ConflictOnCommitPersistence();
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: { [Behavior.Active](ctx) { ctx.stop({ type: StopReasonType.Requested }); } },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: { [Behavior.Active]() {} },
        },
      },
      persistence,
    });

    const root = await system.createRoot(ActorKind.Root, { id: ActorId.root("root"), init: {} });
    await expect(system.runUntilIdle()).rejects.toBeInstanceOf(PersistenceConflictError);

    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true, includeEvents: true, includeDroppedEnvelopes: true });
    const actor = snapshot.actors.find((candidate) => candidate.id === root.id.toString());
    expect(actor?.status).toBe(ActorStatus.Starting);
    expect(snapshot.envelopes.some((candidate) => candidate.kind === EnvelopeKind.Supervision)).toBe(false);
  });

  it("stopped actor dead-letters later user messages", async () => {
    const system = createActorSystem({
      registry,
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: {
            [Behavior.Active](ctx, message) {
              if (message.type === MessageType.Stop) {
                ctx.stop({ type: StopReasonType.Requested });
              }
            },
          },
        },
        [ActorKind.Child]: {
          kind: ActorKind.Child,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: { [Behavior.Active]() {} },
        },
      },
      persistence: new InMemoryActorPersistence(),
    });

    const root = await system.createRoot(ActorKind.Root, { id: ActorId.root("root"), init: {} });
    await system.runUntilIdle();
    await system.send(root, { type: MessageType.Stop } as never);
    await system.runUntilIdle();
    await system.send(root, { type: MessageType.Ping } as never);
    await system.runUntilIdle();

    const actor = await system.inspector.getActor(ActorId.root("root"));
    expect(actor?.actor.status).toBe(ActorStatus.Stopped);
    expect(actor?.mailbox.deadLettered?.some((candidate) => candidate.messageType === MessageType.Ping)).toBe(true);
  });

  it("inspector tolerates actor with unknown kind", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("ghost");
    const persistence = new InMemoryActorPersistence({
      actors: [{
        id: actorId.toString(),
        kind: "ghost-kind",
        status: ActorStatus.Running,
        behavior: Behavior.Active,
        state: { value: 1 },
        init: {},
        generation: 0,
        version: 0,
        createdAt: toIsoDateTimeString(now),
        updatedAt: toIsoDateTimeString(now),
      }],
      envelopes: [{
        id: defaultIdGenerator.envelopeId(),
        kind: EnvelopeKind.User,
        to: actorId.toString(),
        toKind: "ghost-kind",
        message: { type: MessageType.Ping },
        status: EnvelopeStatus.Queued,
        attempt: 0,
        maxAttempts: 1,
        notBefore: toIsoDateTimeString(now),
        priority: 0,
        createdAt: toIsoDateTimeString(now),
        updatedAt: toIsoDateTimeString(now),
      }],
      events: [{
        id: defaultIdGenerator.runtimeEventId(),
        type: RuntimeEventType.ActorCreated,
        actorId: actorId.toString(),
        data: { actorId: actorId.toString(), kind: "ghost-kind" },
        createdAt: toIsoDateTimeString(now),
      }],
    });

    const system = createActorSystem({
      registry: defineRegistry({ [ActorKind.Root]: actorType<{ readonly value: number }, { readonly type: string }, {}, typeof Behavior.Active, never>() }),
      definitions: {
        [ActorKind.Root]: {
          kind: ActorKind.Root,
          init: () => ({ state: { value: 0 }, behavior: Behavior.Active }),
          receive: { [Behavior.Active]() {} },
        },
      },
      persistence,
    });

    const snapshot = await system.inspector.getSnapshot({ includeEvents: true });
    const detail = await system.inspector.getActor(actorId);
    const hierarchy = await system.inspector.getHierarchy({ includePresentation: true });
    expect(snapshot.actors[0]?.presentation).toBeUndefined();
    expect(detail?.actor.presentation).toBeUndefined();
    expect(hierarchy.roots[0]?.kind).toBe("ghost-kind");
  });

  it("commitActivation rejects envelopeUpdates targeting the claimed envelope", async () => {
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
      ifExists: ActorCreateMode.Fail,
    });
    const messageId = defaultIdGenerator.envelopeId();
    await persistence.enqueue([{
      id: messageId, kind: EnvelopeKind.User, to: actorId.toString(), toKind: ActorKind.Root,
      message: { type: MessageType.Ping }, status: EnvelopeStatus.Queued, attempt: 0, maxAttempts: 1,
      notBefore: toIsoDateTimeString(now), priority: 0, createdAt: toIsoDateTimeString(now), updatedAt: toIsoDateTimeString(now),
    }]);
    const claimed = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });
    await expect(persistence.commitActivation(claimed!.claim, {
      actorCreates: [],
      actorUpdates: [],
      envelopeCreates: [],
      envelopeUpdates: [{ id: messageId, expectedStatus: EnvelopeStatus.Processing, patch: { status: EnvelopeStatus.Dropped }, updatedAt: toIsoDateTimeString(now) }],
      events: [],
      completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
    })).rejects.toBeInstanceOf(PersistenceConflictError);
  });
});