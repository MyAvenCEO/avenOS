import { ActorId } from "../core/actor-id.js";
import { ActorStatus, EnvelopeKind, EnvelopeStatus } from "../core/constants.js";
import { defaultIdGenerator, toIsoDateTimeString } from "../core/ids.js";
import { ActorCreateMode, type ActorPersistence } from "../persistence/actor-persistence.js";

export async function assertBasicPersistenceContract(persistence: ActorPersistence): Promise<void> {
  const now = new Date("2024-01-01T00:00:00.000Z");
  const id = ActorId.root("root");
  await persistence.createActor({
    actor: {
      id: id.toString(),
      kind: "counter",
      status: ActorStatus.Starting,
      behavior: "active",
      state: { value: 0 },
      init: { initial: 0 },
      generation: 0,
      version: 0,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
    },
    startEnvelope: {
      id: defaultIdGenerator.envelopeId(),
      kind: EnvelopeKind.LifecycleStart,
      to: id.toString(),
      toKind: "counter",
      message: { type: "system.lifecycle.start" },
      status: EnvelopeStatus.Queued,
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
}