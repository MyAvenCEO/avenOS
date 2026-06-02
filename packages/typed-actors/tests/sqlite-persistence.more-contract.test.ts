import { afterEach, describe, expect, it } from "vitest";
import { ActorId } from "../src/core/actor-id.js";
import { ActorStatus, EnvelopeKind, EnvelopeStatus, StopReasonType } from "../src/core/constants.js";
import { PersistenceConflictError } from "../src/core/errors.js";
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

describe("SqliteActorPersistence extended contract", () => {
  let persistence: SqliteActorPersistence;

  afterEach(() => persistence?.close());

  it("releases expired lease and envelope becomes claimable again", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    persistence = new SqliteActorPersistence(":memory:");
    const actorId = ActorId.root("root").toString();
    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    const envId = defaultIdGenerator.envelopeId();
    await persistence.enqueue([envelopeRecord(envId, actorId, "root", EnvelopeKind.User, now)]);
    const first = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 10 });
    expect(first).toBeDefined();
    const released = await persistence.releaseExpiredLeases(new Date(now.getTime() + 20));
    expect(released).toBe(1);
    const second = await persistence.claimNext({ now: new Date(now.getTime() + 21), ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 10 });
    expect(second?.claim.envelopeId).toBe(envId);
  });

  it("dedupeKey prevents duplicate active envelope", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    persistence = new SqliteActorPersistence(":memory:");
    const actorId = ActorId.root("root").toString();
    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    await persistence.enqueue([
      { ...envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now), dedupeKey: "same" },
      { ...envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now), dedupeKey: "same" },
    ]);
    const snapshot = await persistence.readSnapshot();
    expect(snapshot.envelopes).toHaveLength(1);
    expect(snapshot.envelopes[0]?.dedupeKey).toBe("same");
  });

  it("dedupeKey empty string is treated as present", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    persistence = new SqliteActorPersistence(":memory:");
    const actorId = ActorId.root("root").toString();
    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    await persistence.enqueue([
      { ...envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now), dedupeKey: "" },
      { ...envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now), dedupeKey: "" },
    ]);
    const snapshot = await persistence.readSnapshot();
    expect(snapshot.envelopes).toHaveLength(1);
    expect(snapshot.envelopes[0]?.dedupeKey).toBe("");
  });

  it("snapshot returns deep immutable copies", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    persistence = new SqliteActorPersistence(":memory:");
    const actorId = ActorId.root("root").toString();
    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Starting, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    const snapshot = await persistence.readSnapshot();
    (snapshot.actors[0]!.state as { value: number }).value = 999;
    const reread = await persistence.readSnapshot();
    expect((reread.actors[0]!.state as { value: number }).value).toBe(0);
  });

  it("deterministic actor create is idempotent only for same id kind parent", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    persistence = new SqliteActorPersistence(":memory:");
    const rootId = ActorId.root("root").toString();
    await persistence.createActor({
      actor: actorRecord(rootId, ActorStatus.Starting, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), rootId, "root", EnvelopeKind.LifecycleStart, now),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    const childId = ActorId.parse("/root/child").toString();
    await persistence.createActor({
      actor: actorRecord(childId, ActorStatus.Starting, now, rootId),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), childId, "child", EnvelopeKind.LifecycleStart, now),
      events: [],
      ifExists: ActorCreateMode.OkIfSameKind,
    });
    await persistence.createActor({
      actor: actorRecord(childId, ActorStatus.Starting, now, rootId),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), childId, "child", EnvelopeKind.LifecycleStart, now),
      events: [],
      ifExists: ActorCreateMode.OkIfSameKind,
    });
    await expect(persistence.createActor({
      actor: { ...actorRecord(childId, ActorStatus.Starting, now, rootId), kind: "other" },
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), childId, "other", EnvelopeKind.LifecycleStart, now),
      events: [],
      ifExists: ActorCreateMode.OkIfSameKind,
    })).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("one actor cannot have two processing envelopes", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    persistence = new SqliteActorPersistence(":memory:");
    const actorId = ActorId.root("root").toString();
    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    await persistence.enqueue([
      envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now),
      envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.User, now),
    ]);
    const first = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });
    const second = await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 });
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
  });

  it("claimNext respects lifecycle envelope eligibility", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    persistence = new SqliteActorPersistence(":memory:");
    const actorId = ActorId.root("root").toString();
    await persistence.createActor({
      actor: actorRecord(actorId, ActorStatus.Running, now),
      startEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStart, now, EnvelopeStatus.Completed),
      events: [],
      ifExists: ActorCreateMode.Fail,
    });
    await persistence.enqueue([envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStop, now)]);
    expect(await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 })).toBeUndefined();
    await persistence.requestStop({
      actorId,
      expectedStatuses: [ActorStatus.Running],
      reason: { type: StopReasonType.RuntimeShutdown },
      stopEnvelope: envelopeRecord(defaultIdGenerator.envelopeId(), actorId, "root", EnvelopeKind.LifecycleStop, now),
      events: [],
      now: toIsoDateTimeString(now),
    });
    expect(await persistence.claimNext({ now, ownerId: defaultIdGenerator.runtimeOwnerId(), leaseMs: 1000 })).toBeDefined();
  });
});