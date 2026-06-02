import {
  ActorErrorCode,
  ActorStatus,
  EnvelopeKind,
  EnvelopeStatus,
  RuntimeEventType,
} from "../../core/constants.js";
import type { ActorId } from "../../core/actor-id.js";
import { systemClock, type Clock } from "../../core/clock.js";
import { PersistenceConflictError } from "../../core/errors.js";
import { toIsoDateTimeString } from "../../core/ids.js";
import { cloneJson } from "../../core/json.js";
import {
  ActorCreateMode,
  assertLeaseOwner,
  isEnvelopeEligible,
  throwVersionConflict,
  type ActivationClaim,
  type ActivationCommit,
  type ActivationFailureCommit,
  type ActorCreate,
  type ActorPersistence,
  type ActorUpdate,
  type ClaimNextOptions,
  type ClaimedActivation,
  type CreateActorCommand,
  type EnvelopeUpdate,
  type RequestStopCommand,
} from "../actor-persistence.js";
import type {
  PersistenceSnapshot,
  PersistenceSnapshotOptions,
} from "../persistence-snapshot.js";
import type {
  StoredActor,
  StoredEnvelope,
  StoredRuntimeEvent,
} from "../stored-records.js";

export interface InMemorySnapshot {
  readonly actors: readonly StoredActor[];
  readonly envelopes: readonly StoredEnvelope[];
  readonly events: readonly StoredRuntimeEvent[];
}

function copyActor(actor: StoredActor): StoredActor {
  return {
    ...actor,
    state: cloneJson(actor.state),
    init: cloneJson(actor.init),
  };
}

function copyEnvelope(envelope: StoredEnvelope): StoredEnvelope {
  return {
    ...envelope,
    message: cloneJson(envelope.message),
  };
}

function copyEvent(event: StoredRuntimeEvent): StoredRuntimeEvent {
  return cloneJson(event as never) as StoredRuntimeEvent;
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rejectDuplicateEnvelopeId(
  envelopes: ReadonlyMap<string, StoredEnvelope>,
  envelopeId: string,
): void {
  if (envelopes.has(envelopeId)) {
    throw new PersistenceConflictError(
      ActorErrorCode.PersistenceConflict,
      `Envelope already exists: ${envelopeId}`,
    );
  }
}

function filterAppliedCreateEvents(
  events: readonly StoredRuntimeEvent[],
  actorId: string,
  startEnvelopeId: string,
  options?: { readonly keepEnvelopeCreated?: boolean },
): StoredRuntimeEvent[] {
  return events.filter((event) => {
    if (event.type === RuntimeEventType.ActorCreated && event.data.actorId === actorId) {
      return false;
    }
    if (!options?.keepEnvelopeCreated && event.type === RuntimeEventType.EnvelopeCreated && event.data.envelopeId === startEnvelopeId) {
      return false;
    }
    return true;
  });
}

type ApplyActorCreateResult = "created" | "noop" | "restarted";

function compareEnvelopes(left: StoredEnvelope, right: StoredEnvelope): number {
  if (left.notBefore !== right.notBefore) {
    return left.notBefore.localeCompare(right.notBefore);
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.createdAt.localeCompare(right.createdAt);
}

export class InMemoryActorPersistence implements ActorPersistence {
  private readonly actors = new Map<string, StoredActor>();
  private readonly envelopes = new Map<string, StoredEnvelope>();
  private readonly events: StoredRuntimeEvent[] = [];

  constructor(snapshot?: Partial<InMemorySnapshot>, private readonly clock: Clock = systemClock) {
    if (snapshot) {
      this.seed(snapshot);
    }
  }

  snapshot(): InMemorySnapshot {
    return {
      actors: [...this.actors.values()].map(copyActor),
      envelopes: [...this.envelopes.values()].map(copyEnvelope),
      events: this.events.map(copyEvent),
    };
  }

  seed(snapshot: Partial<InMemorySnapshot>): void {
    this.clear();
    for (const actor of snapshot.actors ?? []) {
      this.actors.set(actor.id, copyActor(actor));
    }
    for (const envelope of snapshot.envelopes ?? []) {
      this.envelopes.set(envelope.id, copyEnvelope(envelope));
    }
    for (const event of snapshot.events ?? []) {
      this.events.push(copyEvent(event));
    }
  }

  clear(): void {
    this.actors.clear();
    this.envelopes.clear();
    this.events.length = 0;
  }

  async createActor(command: CreateActorCommand): Promise<void> {
    const existing = this.actors.get(command.actor.id);
    if (existing) {
      const sameIdentity =
        existing.kind === command.actor.kind &&
        existing.parentId === command.actor.parentId;
      if (command.ifExists === ActorCreateMode.OkIfSameKind && sameIdentity) {
        if (existing.status === ActorStatus.Running || existing.status === ActorStatus.Starting) {
          return;
        }
        rejectDuplicateEnvelopeId(this.envelopes, command.startEnvelope.id);
        this.actors.set(command.actor.id, {
          ...existing,
          behavior: command.actor.behavior,
          state: cloneJson(command.actor.state),
          init: cloneJson(command.actor.init),
          status: ActorStatus.Starting,
          generation: existing.generation + 1,
          version: existing.version + 1,
          updatedAt: command.actor.updatedAt,
        });
        this.envelopes.set(command.startEnvelope.id, copyEnvelope(command.startEnvelope));
        this.events.push(...filterAppliedCreateEvents(command.events, command.actor.id, command.startEnvelope.id, { keepEnvelopeCreated: true }).map(copyEvent));
        return;
      }
      throw new PersistenceConflictError(
        ActorErrorCode.SpawnConflict,
        `Actor already exists at ${command.actor.id}`,
      );
    }
    rejectDuplicateEnvelopeId(this.envelopes, command.startEnvelope.id);
    this.actors.set(command.actor.id, copyActor(command.actor));
    this.envelopes.set(command.startEnvelope.id, copyEnvelope(command.startEnvelope));
    this.events.push(...command.events.map(copyEvent));
  }

  async loadActor(id: ActorId): Promise<StoredActor | undefined> {
    const actor = this.actors.get(id.toString());
    return actor ? copyActor(actor) : undefined;
  }

  async listChildren(parentId: ActorId): Promise<readonly StoredActor[]> {
    return [...this.actors.values()]
      .filter((actor) => actor.parentId === parentId.toString())
      .map(copyActor);
  }

  async enqueue(envelopes: readonly StoredEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      if (envelope.dedupeKey !== undefined) {
        const duplicate = [...this.envelopes.values()].find((candidate) => {
          return (
            candidate.dedupeKey === envelope.dedupeKey &&
            candidate.to === envelope.to &&
            candidate.status !== EnvelopeStatus.Completed &&
            candidate.status !== EnvelopeStatus.Dropped &&
            candidate.status !== EnvelopeStatus.DeadLettered
          );
        });
        if (duplicate) {
          continue;
        }
      }
      rejectDuplicateEnvelopeId(this.envelopes, envelope.id);
      this.envelopes.set(envelope.id, copyEnvelope(envelope));
    }
  }

  async claimNext(options: ClaimNextOptions): Promise<ClaimedActivation | undefined> {
    const nowIso = toIsoDateTimeString(options.now);
    const queued = [...this.envelopes.values()]
      .filter((envelope) => envelope.status === EnvelopeStatus.Queued)
      .sort(compareEnvelopes);
    for (const envelope of queued) {
      if (envelope.notBefore > nowIso) {
        continue;
      }
      const actor = this.actors.get(envelope.to);
      if (!actor || actor.kind !== envelope.toKind) {
        this.envelopes.set(envelope.id, {
          ...envelope,
          status: EnvelopeStatus.DeadLettered,
          updatedAt: nowIso,
        });
        continue;
      }
      if (!isEnvelopeEligible(envelope.kind, actor.status)) {
        if (actor.status === ActorStatus.Stopped) {
          this.envelopes.set(envelope.id, {
            ...envelope,
            status: EnvelopeStatus.DeadLettered,
            updatedAt: nowIso,
          });
        }
        continue;
      }
      const active = [...this.envelopes.values()].some((candidate) => {
        return candidate.to === envelope.to && candidate.status === EnvelopeStatus.Processing;
      });
      if (active) {
        continue;
      }
      const claimedEnvelope: StoredEnvelope = {
        ...envelope,
        status: EnvelopeStatus.Processing,
        leaseOwner: options.ownerId,
        leaseUntil: toIsoDateTimeString(new Date(options.now.getTime() + options.leaseMs)),
        updatedAt: nowIso,
      };
      this.envelopes.set(claimedEnvelope.id, claimedEnvelope);
      return {
        claim: {
          envelopeId: envelope.id,
          actorId: actor.id,
          ownerId: options.ownerId,
          actorVersion: actor.version,
        },
        actor: copyActor(actor),
        envelope: copyEnvelope(claimedEnvelope),
      };
    }
    return undefined;
  }

  async releaseOwnerClaims(ownerId: string, now: Date): Promise<number> {
    const nowIso = toIsoDateTimeString(now);
    let released = 0;
    for (const [id, envelope] of this.envelopes.entries()) {
      if (envelope.status !== EnvelopeStatus.Processing || envelope.leaseOwner !== ownerId) {
        continue;
      }
      this.envelopes.set(id, {
        ...envelope,
        status: EnvelopeStatus.Queued,
        leaseOwner: undefined,
        leaseUntil: undefined,
        updatedAt: nowIso,
      });
      released += 1;
    }
    return released;
  }

  private applyActorCreateTo(
    actors: Map<string, StoredActor>,
    envelopes: Map<string, StoredEnvelope>,
    create: ActorCreate,
  ): ApplyActorCreateResult {
    const existing = actors.get(create.actor.id);
    if (existing) {
      const sameIdentity =
        existing.kind === create.actor.kind &&
        existing.parentId === create.actor.parentId;
      if (create.ifExists === ActorCreateMode.OkIfSameKind && sameIdentity) {
        if (existing.status === ActorStatus.Running || existing.status === ActorStatus.Starting) {
          return "noop";
        }
        rejectDuplicateEnvelopeId(envelopes, create.startEnvelope.id);
        actors.set(create.actor.id, {
          ...existing,
          behavior: create.actor.behavior,
          state: cloneJson(create.actor.state),
          init: cloneJson(create.actor.init),
          status: ActorStatus.Starting,
          generation: existing.generation + 1,
          version: existing.version + 1,
          updatedAt: create.actor.updatedAt,
        });
        envelopes.set(create.startEnvelope.id, copyEnvelope(create.startEnvelope));
        return "restarted";
      }
      throw new PersistenceConflictError(
        ActorErrorCode.SpawnConflict,
        `Actor create conflict at ${create.actor.id}`,
      );
    }
    rejectDuplicateEnvelopeId(envelopes, create.startEnvelope.id);
    actors.set(create.actor.id, copyActor(create.actor));
    envelopes.set(create.startEnvelope.id, copyEnvelope(create.startEnvelope));
    return "created";
  }

  private applyActorUpdateTo(
    actors: Map<string, StoredActor>,
    update: ActorUpdate,
  ): void {
    const existing = actors.get(update.id);
    if (!existing) {
      throwVersionConflict(`Actor ${update.id} not found`);
    }
    if (existing.version !== update.expectedVersion) {
      throwVersionConflict(`Actor version conflict for ${update.id}`);
    }
    actors.set(update.id, {
      ...existing,
      ...update.patch,
      updatedAt: update.updatedAt,
      version: existing.version + 1,
      state: hasOwn(update.patch, "state") ? cloneJson(update.patch.state as StoredActor["state"]) : existing.state,
      init: hasOwn(update.patch, "init") ? cloneJson(update.patch.init as StoredActor["init"]) : existing.init,
    });
  }

  private applyEnvelopeUpdateTo(
    envelopes: Map<string, StoredEnvelope>,
    update: EnvelopeUpdate,
  ): void {
    const existing = envelopes.get(update.id);
    if (!existing) {
      throwVersionConflict(`Envelope ${update.id} not found`);
    }
    if (existing.status !== update.expectedStatus) {
      throwVersionConflict(`Envelope status conflict for ${update.id}`);
    }
    envelopes.set(update.id, {
      ...existing,
      ...update.patch,
      updatedAt: update.updatedAt,
    });
  }

  private replaceState(
    actors: ReadonlyMap<string, StoredActor>,
    envelopes: ReadonlyMap<string, StoredEnvelope>,
    events: readonly StoredRuntimeEvent[],
  ): void {
    this.actors.clear();
    for (const [id, actor] of actors.entries()) {
      this.actors.set(id, actor);
    }

    this.envelopes.clear();
    for (const [id, envelope] of envelopes.entries()) {
      this.envelopes.set(id, envelope);
    }

    this.events.length = 0;
    this.events.push(...events);
  }

  async commitActivation(claim: ActivationClaim, commit: ActivationCommit): Promise<void> {
    const nextActors = new Map(this.actors.entries());
    const nextEnvelopes = new Map(this.envelopes.entries());
    const nextEvents = this.events.slice();

    const actor = nextActors.get(claim.actorId);
    const envelope = nextEnvelopes.get(claim.envelopeId);
    if (!actor || !envelope) {
      throwVersionConflict("Activation claim target missing");
    }
    if (actor.version !== claim.actorVersion) {
      throwVersionConflict(`Actor version mismatch for ${claim.actorId}`);
    }
    if (envelope.status !== EnvelopeStatus.Processing) {
      throwVersionConflict(`Envelope ${claim.envelopeId} is not processing`);
    }
    assertLeaseOwner(envelope, claim.ownerId);

    const commitEvents = commit.events.slice();
    for (const create of commit.actorCreates) {
      const applied = this.applyActorCreateTo(nextActors, nextEnvelopes, create);
      if (applied === "noop") {
        const filteredEvents = filterAppliedCreateEvents(commitEvents, create.actor.id, create.startEnvelope.id);
        commitEvents.length = 0;
        commitEvents.push(...filteredEvents);
      } else if (applied === "restarted") {
        const filteredEvents = filterAppliedCreateEvents(commitEvents, create.actor.id, create.startEnvelope.id, { keepEnvelopeCreated: true });
        commitEvents.length = 0;
        commitEvents.push(...filteredEvents);
      }
    }
    for (const update of commit.actorUpdates) {
      this.applyActorUpdateTo(nextActors, update);
    }
    for (const created of commit.envelopeCreates) {
      rejectDuplicateEnvelopeId(nextEnvelopes, created.id);
      nextEnvelopes.set(created.id, copyEnvelope(created));
    }
    for (const update of commit.envelopeUpdates) {
      if (update.id === claim.envelopeId) {
        throw new PersistenceConflictError(
          ActorErrorCode.PersistenceConflict,
          "Activation commits must not update the claimed envelope through envelopeUpdates",
        );
      }
      this.applyEnvelopeUpdateTo(nextEnvelopes, update);
    }
    nextEvents.push(...commitEvents.map(copyEvent));
    nextEnvelopes.set(claim.envelopeId, {
      ...envelope,
      status: commit.completeClaimedEnvelopeAs,
      leaseOwner: undefined,
      leaseUntil: undefined,
      updatedAt:
        commit.actorUpdates[0]?.updatedAt
        ?? commit.events[commit.events.length - 1]?.createdAt
        ?? envelope.updatedAt,
    });

    this.replaceState(nextActors, nextEnvelopes, nextEvents);
  }

  async failActivation(
    claim: ActivationClaim,
    failure: ActivationFailureCommit,
  ): Promise<void> {
    const nextActors = new Map(this.actors.entries());
    const nextEnvelopes = new Map(this.envelopes.entries());
    const nextEvents = this.events.slice();

    const actor = nextActors.get(claim.actorId);
    const envelope = nextEnvelopes.get(claim.envelopeId);
    if (!actor || !envelope) {
      throwVersionConflict("Activation failure target missing");
    }
    if (actor.version !== claim.actorVersion) {
      throwVersionConflict(`Actor version mismatch for ${claim.actorId}`);
    }
    if (envelope.status !== EnvelopeStatus.Processing) {
      throwVersionConflict(`Envelope ${claim.envelopeId} is not processing`);
    }
    assertLeaseOwner(envelope, claim.ownerId);

    nextActors.set(actor.id, {
      ...actor,
      ...failure.actorPatch,
      updatedAt: toIsoDateTimeString(failure.now),
      version: actor.version + 1,
      state: hasOwn(failure.actorPatch, "state") ? cloneJson(failure.actorPatch.state as StoredActor["state"]) : actor.state,
      init: hasOwn(failure.actorPatch, "init") ? cloneJson(failure.actorPatch.init as StoredActor["init"]) : actor.init,
    });
    for (const update of failure.actorUpdates ?? []) {
      this.applyActorUpdateTo(nextActors, update);
    }
    nextEnvelopes.set(envelope.id, {
      ...envelope,
      attempt: envelope.attempt + 1,
      status: failure.failedEnvelopeStatus,
      leaseOwner: undefined,
      leaseUntil: undefined,
      updatedAt: toIsoDateTimeString(failure.now),
    });
    for (const created of failure.envelopeCreates) {
      rejectDuplicateEnvelopeId(nextEnvelopes, created.id);
      nextEnvelopes.set(created.id, copyEnvelope(created));
    }
    nextEvents.push(...failure.events.map(copyEvent));
    this.replaceState(nextActors, nextEnvelopes, nextEvents);
  }

  async requestStop(command: RequestStopCommand): Promise<void> {
    const nextActors = new Map(this.actors.entries());
    const nextEnvelopes = new Map(this.envelopes.entries());
    const nextEvents = this.events.slice();

    const actor = nextActors.get(command.actorId);
    if (!actor) {
      throwVersionConflict(`Actor ${command.actorId} not found`);
    }
    if (actor.status === ActorStatus.Stopped) {
      return;
    }
    if (!command.expectedStatuses.includes(actor.status) && actor.status !== ActorStatus.Stopping) {
      throwVersionConflict(`Actor ${command.actorId} status conflict`);
    }

    const hasPendingStop = [...nextEnvelopes.values()].some((envelope) => {
      return envelope.to === actor.id
        && envelope.kind === EnvelopeKind.LifecycleStop
        && (envelope.status === EnvelopeStatus.Queued || envelope.status === EnvelopeStatus.Processing);
    });

    if (actor.status === ActorStatus.Stopping && hasPendingStop) {
      return;
    }

    rejectDuplicateEnvelopeId(nextEnvelopes, command.stopEnvelope.id);

    if (actor.status !== ActorStatus.Stopping) {
      nextActors.set(actor.id, {
        ...actor,
        status: ActorStatus.Stopping,
        updatedAt: command.now,
        version: actor.version + 1,
      });
      nextEvents.push(...command.events.map(copyEvent));
    } else {
      nextEvents.push(
        ...command.events
          .filter((event) => event.type === RuntimeEventType.EnvelopeCreated)
          .map(copyEvent),
      );
    }
    nextEnvelopes.set(command.stopEnvelope.id, copyEnvelope(command.stopEnvelope));

    this.replaceState(nextActors, nextEnvelopes, nextEvents);
  }

  async releaseExpiredLeases(now: Date): Promise<number> {
    const nowIso = toIsoDateTimeString(now);
    let released = 0;
    for (const [id, envelope] of this.envelopes.entries()) {
      if (
        envelope.status === EnvelopeStatus.Processing &&
        envelope.leaseUntil &&
        envelope.leaseUntil <= nowIso
      ) {
        this.envelopes.set(id, {
          ...envelope,
          status: EnvelopeStatus.Queued,
          leaseOwner: undefined,
          leaseUntil: undefined,
          updatedAt: nowIso,
        });
        released += 1;
      }
    }
    return released;
  }

  async readSnapshot(
    options?: PersistenceSnapshotOptions,
  ): Promise<PersistenceSnapshot> {
    const completedEnvelopeLimit = options?.completedEnvelopeLimit;
    return {
      takenAt: toIsoDateTimeString(this.clock.now()),
      actors: [...this.actors.values()].map(copyActor),
      envelopes: [...this.envelopes.values()]
        .filter((envelope) => {
          if (!options?.includeCompletedEnvelopes && envelope.status === EnvelopeStatus.Completed) {
            return false;
          }
          if (!options?.includeDroppedEnvelopes && envelope.status === EnvelopeStatus.Dropped) {
            return false;
          }
          return true;
        })
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
        .filter((envelope, _, envelopes) => {
          if (completedEnvelopeLimit === undefined || envelope.status !== EnvelopeStatus.Completed) {
            return true;
          }
          const completed = envelopes.filter((candidate) => candidate.status === EnvelopeStatus.Completed);
          return completed.slice(-completedEnvelopeLimit).some((candidate) => candidate.id === envelope.id);
        })
        .map(copyEnvelope),
      events: options?.includeEvents
        ? this.events.slice(-(options.eventLimit ?? this.events.length)).map(copyEvent)
        : [],
    };
  }
}