import { describe, expect, it } from "vitest";
import { ActorId } from "../src/core/actor-id.js";
import { ActorStatus, EnvelopeKind, EnvelopeStatus } from "../src/core/constants.js";
import { PersistenceConflictError } from "../src/core/errors.js";
import { defaultIdGenerator, toIsoDateTimeString } from "../src/core/ids.js";
import { ActorCreateMode } from "../src/persistence/actor-persistence.js";
import { InMemoryActorPersistence } from "../src/persistence/in-memory/in-memory-persistence.js";
import type { StoredActor, StoredEnvelope } from "../src/persistence/stored-records.js";

function actorRecord(id: string, now: Date, status: ActorStatus = ActorStatus.Running, parentId?: string): StoredActor {
  return {
    id,
    kind: parentId ? "child" : "root",
    ...(parentId ? { parentId } : {}),
    status,
    behavior: "active",
    state: { value: 0 },
    init: { value: 0 },
    generation: 0,
    version: 0,
    createdAt: toIsoDateTimeString(now),
    updatedAt: toIsoDateTimeString(now),
  } as unknown as StoredActor;
}

function envelopeRecord(
  id: string,
  to: string,
  toKind: string,
  kind: EnvelopeKind,
  now: Date,
  status: EnvelopeStatus,
): StoredEnvelope {
  return {
    id,
    kind,
    to,
    toKind,
    message: { type: kind === EnvelopeKind.User ? "msg" : "system.lifecycle.start" },
    status,
    attempt: 0,
    maxAttempts: 1,
    notBefore: toIsoDateTimeString(now),
    priority: 0,
    createdAt: toIsoDateTimeString(now),
    updatedAt: toIsoDateTimeString(now),
  } as unknown as StoredEnvelope;
}

describe("duplicate envelope id insertion paths", () => {
  it("actor create rejects duplicate start envelope id", async () => {
    const persistence = new InMemoryActorPersistence();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const duplicateEnvelopeId = defaultIdGenerator.envelopeId();
    await persistence.createActor({
      actor: actorRecord(ActorId.root("root").toString(), now, ActorStatus.Starting),
      startEnvelope: envelopeRecord(duplicateEnvelopeId, ActorId.root("root").toString(), "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Queued),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });

    await expect(persistence.createActor({
      actor: actorRecord(ActorId.root("other").toString(), now, ActorStatus.Starting),
      startEnvelope: envelopeRecord(duplicateEnvelopeId, ActorId.root("other").toString(), "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Queued),
      events: [],
      ifExists: ActorCreateMode.Fail,
    })).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("commitActivation rejects duplicate outgoing envelope id", async () => {
    const persistence = new InMemoryActorPersistence();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root").toString();
    const startEnvelopeId = defaultIdGenerator.envelopeId();
    await persistence.createActor({
      actor: actorRecord(actorId, now),
      startEnvelope: envelopeRecord(startEnvelopeId, actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    const messageId = defaultIdGenerator.envelopeId();
    await persistence.enqueue([envelopeRecord(messageId, actorId, "root", EnvelopeKind.User, now, EnvelopeStatus.Queued)]);
    const claimed = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });

    await expect(persistence.commitActivation(claimed!.claim, {
      actorCreates: [],
      actorUpdates: [],
      envelopeCreates: [envelopeRecord(startEnvelopeId, actorId, "root", EnvelopeKind.User, now, EnvelopeStatus.Queued)],
      envelopeUpdates: [],
      events: [],
      completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
    })).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("failActivation rejects duplicate supervision envelope id", async () => {
    const persistence = new InMemoryActorPersistence();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root").toString();
    const duplicateEnvelopeId = defaultIdGenerator.envelopeId();
    await persistence.createActor({
      actor: actorRecord(actorId, now),
      startEnvelope: envelopeRecord(duplicateEnvelopeId, actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    const messageId = defaultIdGenerator.envelopeId();
    await persistence.enqueue([envelopeRecord(messageId, actorId, "root", EnvelopeKind.User, now, EnvelopeStatus.Queued)]);
    const claimed = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });

    await expect(persistence.failActivation(claimed!.claim, {
      now,
      error: { name: "Error", message: "boom" },
      actorPatch: { status: ActorStatus.Suspended },
      failedEnvelopeStatus: EnvelopeStatus.Faulted,
      envelopeCreates: [
        {
          ...envelopeRecord(duplicateEnvelopeId, actorId, "root", EnvelopeKind.Supervision, now, EnvelopeStatus.Queued),
          message: { type: "system.supervision", failure: { child: { id: actorId, kind: "root", generation: 0 }, envelope: { id: messageId, kind: EnvelopeKind.User, messageType: "msg", attempt: 1, maxAttempts: 1 }, error: { name: "Error", message: "boom" }, occurredAt: toIsoDateTimeString(now) } },
        },
      ],
      events: [],
    })).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("requestStop rejects duplicate stop envelope id", async () => {
    const persistence = new InMemoryActorPersistence();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root").toString();
    const duplicateEnvelopeId = defaultIdGenerator.envelopeId();
    await persistence.createActor({
      actor: actorRecord(actorId, now),
      startEnvelope: envelopeRecord(duplicateEnvelopeId, actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });

    await expect(persistence.requestStop({
      actorId,
      expectedStatuses: [ActorStatus.Running],
      reason: { type: "requested" },
      stopEnvelope: envelopeRecord(duplicateEnvelopeId, actorId, "root", EnvelopeKind.LifecycleStop, now, EnvelopeStatus.Queued),
      events: [],
      now: toIsoDateTimeString(now),
    })).rejects.toBeInstanceOf(PersistenceConflictError);
  });
});