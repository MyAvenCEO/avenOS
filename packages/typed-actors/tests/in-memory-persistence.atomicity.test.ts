import { describe, expect, it } from "vitest";
import { ActorId } from "../src/core/actor-id.js";
import { ActorStatus, EnvelopeKind, EnvelopeStatus } from "../src/core/constants.js";
import { defaultIdGenerator, toIsoDateTimeString } from "../src/core/ids.js";
import { ActorCreateMode } from "../src/persistence/actor-persistence.js";
import { InMemoryActorPersistence } from "../src/persistence/in-memory/in-memory-persistence.js";

describe("InMemoryActorPersistence atomicity", () => {
  it("does not partially apply commitActivation when a later operation conflicts", async () => {
    const persistence = new InMemoryActorPersistence();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const rootId = ActorId.root("root");

    await persistence.createActor({
      actor: {
        id: rootId.toString(),
        kind: "root",
        status: ActorStatus.Running,
        behavior: "active",
        state: { value: 0 },
        init: { value: 0 },
        generation: 0,
        version: 0,
        createdAt: toIsoDateTimeString(now),
        updatedAt: toIsoDateTimeString(now),
      },
      startEnvelope: {
        id: defaultIdGenerator.envelopeId(),
        kind: EnvelopeKind.LifecycleStart,
        to: rootId.toString(),
        toKind: "root",
        message: { type: "system.lifecycle.start" },
        status: EnvelopeStatus.Completed,
        attempt: 0,
        maxAttempts: 1,
        notBefore: toIsoDateTimeString(now),
        priority: 0,
        createdAt: toIsoDateTimeString(now),
        updatedAt: toIsoDateTimeString(now),
      },
      events: [],
      ifExists: ActorCreateMode.Fail,
    });

    const messageEnvelopeId = defaultIdGenerator.envelopeId();
    await persistence.enqueue([
      {
        id: messageEnvelopeId,
        kind: EnvelopeKind.User,
        to: rootId.toString(),
        toKind: "root",
        message: { type: "msg" },
        status: EnvelopeStatus.Queued,
        attempt: 0,
        maxAttempts: 1,
        notBefore: toIsoDateTimeString(now),
        priority: 0,
        createdAt: toIsoDateTimeString(now),
        updatedAt: toIsoDateTimeString(now),
      },
    ]);

    const claimed = await persistence.claimNext({
      now,
      ownerId: defaultIdGenerator.runtimeOwnerId(),
      leaseMs: 1_000,
    });

    expect(claimed).toBeDefined();

    await expect(
      persistence.commitActivation(claimed!.claim, {
        actorCreates: [
          {
            actor: {
              id: ActorId.parse("/root/child").toString(),
              kind: "child",
              parentId: rootId.toString(),
              status: ActorStatus.Starting,
              behavior: "active",
              state: { value: 1 },
              init: { value: 1 },
              generation: 0,
              version: 0,
              createdAt: toIsoDateTimeString(now),
              updatedAt: toIsoDateTimeString(now),
            },
            startEnvelope: {
              id: defaultIdGenerator.envelopeId(),
              kind: EnvelopeKind.LifecycleStart,
              to: ActorId.parse("/root/child").toString(),
              toKind: "child",
              message: { type: "system.lifecycle.start" },
              status: EnvelopeStatus.Queued,
              attempt: 0,
              maxAttempts: 1,
              notBefore: toIsoDateTimeString(now),
              priority: 0,
              createdAt: toIsoDateTimeString(now),
              updatedAt: toIsoDateTimeString(now),
            },
            ifExists: ActorCreateMode.Fail,
          },
        ],
        actorUpdates: [],
        envelopeCreates: [],
        envelopeUpdates: [
          {
            id: messageEnvelopeId,
            expectedStatus: EnvelopeStatus.Queued,
            patch: { priority: 1 },
            updatedAt: toIsoDateTimeString(now),
          },
        ],
        events: [],
        completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
      }),
    ).rejects.toThrow();

    const snapshot = await persistence.readSnapshot({ includeCompletedEnvelopes: true });
    expect(snapshot.actors.some((actor) => actor.id === "/root/child")).toBe(false);
    expect(snapshot.envelopes.find((envelope) => envelope.id === messageEnvelopeId)?.status).toBe(EnvelopeStatus.Processing);
  });
});