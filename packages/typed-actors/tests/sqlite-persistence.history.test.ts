import { afterEach, describe, expect, it } from "vitest";
import { ActorId } from "../src/core/actor-id.js";
import { ActorStatus, EnvelopeKind, EnvelopeStatus } from "../src/core/constants.js";
import { defaultIdGenerator, toIsoDateTimeString } from "../src/core/ids.js";
import { ActorCreateMode } from "../src/persistence/actor-persistence.js";
import { SqliteActorPersistence } from "../src/persistence/sqlite/sqlite-persistence.js";
import type { StoredActor, StoredEnvelope } from "../src/persistence/stored-records.js";

function actorRecord(id: string, status: ActorStatus, now: Date, parentId?: string): StoredActor {
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
  status: EnvelopeStatus = EnvelopeStatus.Queued,
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

describe("SqliteActorPersistence history", () => {
  let persistence: SqliteActorPersistence;

  afterEach(() => persistence?.close());

  it("actor state history is recorded on create", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root").toString();
    persistence = new SqliteActorPersistence(":memory:");

    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Starting, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });

    const history = persistence.readActorHistory(actorId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ actor_id: actorId, version: 0, envelope_id: null });
  });

  it("actor state history is recorded on commit", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root").toString();
    persistence = new SqliteActorPersistence(":memory:");

    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    const userEnvelope = envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now);
    await persistence.enqueue([userEnvelope]);
    const claimed = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });

    await persistence.commitActivation(claimed!.claim, {
      actorCreates: [],
      actorUpdates: [{
        id: actorId,
        expectedVersion: 0,
        patch: { state: { value: 1 } },
        updatedAt: toIsoDateTimeString(new Date(now.getTime() + 1)),
      }],
      envelopeCreates: [],
      envelopeUpdates: [],
      events: [],
      completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
    });

    const history = persistence.readActorHistory(actorId);
    expect(history).toHaveLength(2);
    expect(history.map((row) => row.version)).toEqual([0, 1]);
    expect(history[1]?.envelope_id).toBe(claimed!.claim.envelopeId);
  });

  it("envelope history is recorded through full lifecycle", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root").toString();
    persistence = new SqliteActorPersistence(":memory:");

    const startEnvelope = envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Queued);
    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope,
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    const userEnvelope = envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now);
    await persistence.enqueue([userEnvelope]);
    const claimed = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });
    await persistence.commitActivation(claimed!.claim, {
      actorCreates: [],
      actorUpdates: [],
      envelopeCreates: [],
      envelopeUpdates: [],
      events: [],
      completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
    });

    expect(persistence.readEnvelopeHistory(startEnvelope.id).map((row) => row.status)).toEqual([EnvelopeStatus.Queued]);
    expect(persistence.readEnvelopeHistory(userEnvelope.id).map((row) => row.status)).toEqual([
      EnvelopeStatus.Queued,
      EnvelopeStatus.Processing,
      EnvelopeStatus.Completed,
    ]);
  });

  it("history survives across operations", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    const actorId = ActorId.root("root").toString();
    persistence = new SqliteActorPersistence(":memory:");

    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });

    const one = envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now);
    await persistence.enqueue([one]);
    const firstClaim = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 5 });
    await persistence.releaseOwnerClaims(firstClaim!.claim.ownerId, new Date(now.getTime() + 1));
    const secondClaim = await persistence.claimNext({ now: new Date(now.getTime() + 2), ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });
    await persistence.failActivation(secondClaim!.claim, {
      now: new Date(now.getTime() + 3),
      error: { name: "Error", message: "boom" },
      actorPatch: { status: ActorStatus.Suspended },
      failedEnvelopeStatus: EnvelopeStatus.Faulted,
      envelopeCreates: [],
      events: [],
    });

    const statuses = persistence.readEnvelopeHistory(one.id).map((row) => row.status);
    expect(statuses).toEqual([
      EnvelopeStatus.Queued,
      EnvelopeStatus.Processing,
      EnvelopeStatus.Queued,
      EnvelopeStatus.Processing,
      EnvelopeStatus.Faulted,
    ]);
    const actorHistory = persistence.readActorHistory(actorId);
    expect(actorHistory.map((row) => row.version)).toEqual([0, 1]);
  });
});