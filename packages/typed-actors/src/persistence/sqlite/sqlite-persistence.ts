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
import {
  ActorCreateMode,
  assertLeaseOwner,
  isEnvelopeEligible,
  throwVersionConflict,
  type ActivationClaim,
  type ActivationCommit,
  type ActivationFailureCommit,
  type ActorCreate,
  type ActorPatch,
  type ActorPersistence,
  type ActorUpdate,
  type ClaimNextOptions,
  type ClaimedActivation,
  type CreateActorCommand,
  type EnvelopePatch,
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
import {
  openAvenSqliteDatabase,
  type AvenSqliteDatabase,
} from "./database.js";

export interface SqlitePersistenceOptions {
  /** WAL mode for better read concurrency. Default: true */
  walMode?: boolean;
}

type ActorHistoryRow = {
  actor_id: string;
  version: number;
  status: string;
  envelope_id: string | null;
  data: string;
  recorded_at: string;
};

type EnvelopeHistoryRow = {
  envelope_id: string;
  status: string;
  data: string;
  recorded_at: string;
};

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseActor(row: { data: string } | undefined): StoredActor | undefined {
  return row ? JSON.parse(row.data) as StoredActor : undefined;
}

function parseEnvelope(row: { data: string } | undefined): StoredEnvelope | undefined {
  return row ? JSON.parse(row.data) as StoredEnvelope : undefined;
}

function parseEvent(row: { data: string }): StoredRuntimeEvent {
  return JSON.parse(row.data) as StoredRuntimeEvent;
}

function compareEnvelopes(left: StoredEnvelope, right: StoredEnvelope): number {
  if (left.notBefore !== right.notBefore) {
    return left.notBefore.localeCompare(right.notBefore);
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.createdAt.localeCompare(right.createdAt);
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

export class SqliteActorPersistence implements ActorPersistence {
  private readonly db: AvenSqliteDatabase;
  private readonly clock: Clock;

  constructor(
    pathOrDb: string | AvenSqliteDatabase,
    options?: SqlitePersistenceOptions,
    clock: Clock = systemClock,
  ) {
    this.db = typeof pathOrDb === "string"
      ? openAvenSqliteDatabase(pathOrDb, { walMode: options?.walMode })
      : pathOrDb;
    this.clock = clock;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actors (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        parent_id   TEXT,
        status      TEXT NOT NULL,
        version     INTEGER NOT NULL,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS envelopes (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        to_actor     TEXT NOT NULL,
        to_kind      TEXT NOT NULL,
        status       TEXT NOT NULL,
        priority     INTEGER NOT NULL,
        not_before   TEXT NOT NULL,
        lease_owner  TEXT,
        lease_until  TEXT,
        dedupe_key   TEXT,
        data         TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_events (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        actor_id    TEXT,
        envelope_id TEXT,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS actor_state_history (
        rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id    TEXT NOT NULL,
        version     INTEGER NOT NULL,
        status      TEXT NOT NULL,
        envelope_id TEXT,
        data        TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS envelope_history (
        rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
        envelope_id TEXT NOT NULL,
        status      TEXT NOT NULL,
        data        TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_actors_parent ON actors(parent_id);
      CREATE INDEX IF NOT EXISTS idx_envelopes_status ON envelopes(status, not_before, priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_envelopes_to_status ON envelopes(to_actor, status);
      CREATE INDEX IF NOT EXISTS idx_envelopes_dedupe ON envelopes(dedupe_key, to_actor, status);
      CREATE INDEX IF NOT EXISTS idx_envelopes_lease ON envelopes(status, lease_until);
      CREATE INDEX IF NOT EXISTS idx_actor_history ON actor_state_history(actor_id, version);
      CREATE INDEX IF NOT EXISTS idx_envelope_history ON envelope_history(envelope_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON runtime_events(type);
    `);
  }

  close(): void {
    this.db.close();
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure and rethrow original error
      }
      throw error;
    }
  }

  private actorRow(id: string): { id: string; kind: string; parent_id: string | null; data: string } | undefined {
    return this.db
      .prepare("SELECT id, kind, parent_id, data FROM actors WHERE id = ?")
      .get(id) as { id: string; kind: string; parent_id: string | null; data: string } | undefined;
  }

  private actorData(id: string): StoredActor | undefined {
    return parseActor(this.db.prepare("SELECT data FROM actors WHERE id = ?").get(id) as { data: string } | undefined);
  }

  private envelopeData(id: string): StoredEnvelope | undefined {
    return parseEnvelope(this.db.prepare("SELECT data FROM envelopes WHERE id = ?").get(id) as { data: string } | undefined);
  }

  private rejectDuplicateEnvelopeId(envelopeId: string): void {
    const existing = this.db.prepare("SELECT id FROM envelopes WHERE id = ?").get(envelopeId) as { id: string } | undefined;
    if (existing) {
      throw new PersistenceConflictError(
        ActorErrorCode.PersistenceConflict,
        `Envelope already exists: ${envelopeId}`,
      );
    }
  }

  private insertActor(actor: StoredActor): void {
    this.db.prepare(`
      INSERT INTO actors (id, kind, parent_id, status, version, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actor.id,
      actor.kind,
      actor.parentId ?? null,
      actor.status,
      actor.version,
      JSON.stringify(actor),
      actor.createdAt,
      actor.updatedAt,
    );
  }

  private insertEnvelope(envelope: StoredEnvelope): void {
    this.db.prepare(`
      INSERT INTO envelopes (
        id, kind, to_actor, to_kind, status, priority, not_before,
        lease_owner, lease_until, dedupe_key, data, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      envelope.id,
      envelope.kind,
      envelope.to,
      envelope.toKind,
      envelope.status,
      envelope.priority,
      envelope.notBefore,
      envelope.leaseOwner ?? null,
      envelope.leaseUntil ?? null,
      envelope.dedupeKey ?? null,
      JSON.stringify(envelope),
      envelope.createdAt,
      envelope.updatedAt,
    );
  }

  private insertRuntimeEvents(events: readonly StoredRuntimeEvent[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO runtime_events (id, type, actor_id, envelope_id, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const event of events) {
      stmt.run(
        event.id,
        event.type,
        event.actorId ?? null,
        event.envelopeId ?? null,
        JSON.stringify(event),
        event.createdAt,
      );
    }
  }

  private recordActorHistory(actor: StoredActor, envelopeId: string | null): void {
    this.db.prepare(`
      INSERT INTO actor_state_history (actor_id, version, status, envelope_id, data, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      actor.id,
      actor.version,
      actor.status,
      envelopeId,
      JSON.stringify(actor),
      actor.updatedAt,
    );
  }

  private recordEnvelopeHistory(envelope: StoredEnvelope): void {
    this.db.prepare(`
      INSERT INTO envelope_history (envelope_id, status, data, recorded_at)
      VALUES (?, ?, ?, ?)
    `).run(
      envelope.id,
      envelope.status,
      JSON.stringify(envelope),
      envelope.updatedAt,
    );
  }

  private updateActor(actor: StoredActor): void {
    this.db.prepare(`
      UPDATE actors
      SET kind = ?, parent_id = ?, status = ?, version = ?, data = ?, created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      actor.kind,
      actor.parentId ?? null,
      actor.status,
      actor.version,
      JSON.stringify(actor),
      actor.createdAt,
      actor.updatedAt,
      actor.id,
    );
  }

  private updateEnvelope(envelope: StoredEnvelope): void {
    this.db.prepare(`
      UPDATE envelopes
      SET kind = ?, to_actor = ?, to_kind = ?, status = ?, priority = ?, not_before = ?,
          lease_owner = ?, lease_until = ?, dedupe_key = ?, data = ?, created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      envelope.kind,
      envelope.to,
      envelope.toKind,
      envelope.status,
      envelope.priority,
      envelope.notBefore,
      envelope.leaseOwner ?? null,
      envelope.leaseUntil ?? null,
      envelope.dedupeKey ?? null,
      JSON.stringify(envelope),
      envelope.createdAt,
      envelope.updatedAt,
      envelope.id,
    );
  }

  private applyActorPatch(
    actor: StoredActor,
    patch: ActorPatch,
    updatedAt: StoredActor["updatedAt"],
  ): StoredActor {
    return {
      ...actor,
      ...patch,
      updatedAt,
      version: actor.version + 1,
      state: hasOwn(patch, "state") ? patch.state as StoredActor["state"] : actor.state,
      init: hasOwn(patch, "init") ? patch.init as StoredActor["init"] : actor.init,
    };
  }

  private applyEnvelopePatch(
    envelope: StoredEnvelope,
    patch: EnvelopePatch,
    updatedAt: StoredEnvelope["updatedAt"],
  ): StoredEnvelope {
    return {
      ...envelope,
      ...patch,
      updatedAt,
    };
  }

  private verifyAndApplyActorUpdate(update: ActorUpdate): StoredActor {
    const existing = this.actorData(update.id);
    if (!existing) {
      throwVersionConflict(`Actor ${update.id} not found`);
    }
    if (existing.version !== update.expectedVersion) {
      throwVersionConflict(`Actor version conflict for ${update.id}`);
    }
    const next = this.applyActorPatch(existing, update.patch, update.updatedAt);
    this.updateActor(next);
    return next;
  }

  private verifyAndApplyEnvelopeUpdate(update: EnvelopeUpdate): StoredEnvelope {
    const existing = this.envelopeData(update.id);
    if (!existing) {
      throwVersionConflict(`Envelope ${update.id} not found`);
    }
    if (existing.status !== update.expectedStatus) {
      throwVersionConflict(`Envelope status conflict for ${update.id}`);
    }
    const next = this.applyEnvelopePatch(existing, update.patch, update.updatedAt);
    this.updateEnvelope(next);
    return next;
  }

  private applyActorCreate(create: ActorCreate): ApplyActorCreateResult {
    const existingRow = this.actorRow(create.actor.id);
    if (existingRow) {
      const sameIdentity =
        existingRow.kind === create.actor.kind &&
        existingRow.parent_id === (create.actor.parentId ?? null);
      if (create.ifExists === ActorCreateMode.OkIfSameKind && sameIdentity) {
        const existing = this.actorData(create.actor.id);
        if (!existing) {
          throw new PersistenceConflictError(
            ActorErrorCode.PersistenceConflict,
            `Actor data missing for ${create.actor.id}`,
          );
        }
        if (existing.status === ActorStatus.Running || existing.status === ActorStatus.Starting) {
          return "noop";
        }
        this.rejectDuplicateEnvelopeId(create.startEnvelope.id);
        const restarted: StoredActor = {
          ...existing,
          behavior: create.actor.behavior,
          state: create.actor.state,
          init: create.actor.init,
          status: ActorStatus.Starting,
          generation: existing.generation + 1,
          version: existing.version + 1,
          updatedAt: create.actor.updatedAt,
        };
        this.updateActor(restarted);
        this.insertEnvelope(create.startEnvelope);
        this.recordActorHistory(restarted, null);
        this.recordEnvelopeHistory(create.startEnvelope);
        return "restarted";
      }
      throw new PersistenceConflictError(
        ActorErrorCode.SpawnConflict,
        `Actor create conflict at ${create.actor.id}`,
      );
    }
    this.rejectDuplicateEnvelopeId(create.startEnvelope.id);
    this.insertActor(create.actor);
    this.insertEnvelope(create.startEnvelope);
    this.recordActorHistory(create.actor, null);
    this.recordEnvelopeHistory(create.startEnvelope);
    return "created";
  }

  async createActor(command: CreateActorCommand): Promise<void> {
    return this.inTransaction(() => {
      const existing = this.actorRow(command.actor.id);
      if (existing) {
        const sameIdentity =
          existing.kind === command.actor.kind &&
          existing.parent_id === (command.actor.parentId ?? null);
        if (command.ifExists === ActorCreateMode.OkIfSameKind && sameIdentity) {
          const actor = this.actorData(command.actor.id);
          if (!actor) {
            throw new PersistenceConflictError(
              ActorErrorCode.PersistenceConflict,
              `Actor data missing for ${command.actor.id}`,
            );
          }
          if (actor.status === ActorStatus.Running || actor.status === ActorStatus.Starting) {
            return;
          }
          this.rejectDuplicateEnvelopeId(command.startEnvelope.id);
          const restarted: StoredActor = {
            ...actor,
            behavior: command.actor.behavior,
            state: command.actor.state,
            init: command.actor.init,
            status: ActorStatus.Starting,
            generation: actor.generation + 1,
            version: actor.version + 1,
            updatedAt: command.actor.updatedAt,
          };
          this.updateActor(restarted);
          this.insertEnvelope(command.startEnvelope);
          this.insertRuntimeEvents(
            filterAppliedCreateEvents(command.events, command.actor.id, command.startEnvelope.id, { keepEnvelopeCreated: true }),
          );
          this.recordActorHistory(restarted, null);
          this.recordEnvelopeHistory(command.startEnvelope);
          return;
        }
        throw new PersistenceConflictError(
          ActorErrorCode.SpawnConflict,
          `Actor already exists at ${command.actor.id}`,
        );
      }
      this.rejectDuplicateEnvelopeId(command.startEnvelope.id);
      this.insertActor(command.actor);
      this.insertEnvelope(command.startEnvelope);
      this.insertRuntimeEvents(command.events);
      this.recordActorHistory(command.actor, null);
      this.recordEnvelopeHistory(command.startEnvelope);
    });
  }

  async loadActor(id: ActorId): Promise<StoredActor | undefined> {
    return this.actorData(id.toString());
  }

  async listChildren(parentId: ActorId): Promise<readonly StoredActor[]> {
    const rows = this.db
      .prepare("SELECT data FROM actors WHERE parent_id = ?")
      .all(parentId.toString()) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as StoredActor);
  }

  async enqueue(envelopes: readonly StoredEnvelope[]): Promise<void> {
    return this.inTransaction(() => {
      for (const envelope of envelopes) {
        if (envelope.dedupeKey !== undefined) {
          const duplicate = this.db.prepare(`
            SELECT id FROM envelopes
            WHERE dedupe_key = ?
              AND to_actor = ?
              AND status NOT IN (?, ?, ?)
            LIMIT 1
          `).get(
            envelope.dedupeKey,
            envelope.to,
            EnvelopeStatus.Completed,
            EnvelopeStatus.Dropped,
            EnvelopeStatus.DeadLettered,
          ) as { id: string } | undefined;
          if (duplicate) {
            continue;
          }
        }
        this.rejectDuplicateEnvelopeId(envelope.id);
        this.insertEnvelope(envelope);
        this.recordEnvelopeHistory(envelope);
      }
    });
  }

  async claimNext(options: ClaimNextOptions): Promise<ClaimedActivation | undefined> {
    return this.inTransaction(() => {
      const nowIso = toIsoDateTimeString(options.now);
      const queuedRows = this.db.prepare(`
        SELECT data FROM envelopes
        WHERE status = ? AND not_before <= ?
        ORDER BY not_before, priority DESC, created_at
      `).all(EnvelopeStatus.Queued, nowIso) as Array<{ data: string }>;
      const queued = queuedRows.map((row) => JSON.parse(row.data) as StoredEnvelope).sort(compareEnvelopes);

      for (const envelope of queued) {
        const actor = this.actorData(envelope.to);
        if (!actor || actor.kind !== envelope.toKind) {
          const dead = {
            ...envelope,
            status: EnvelopeStatus.DeadLettered,
            updatedAt: nowIso,
          } satisfies StoredEnvelope;
          this.updateEnvelope(dead);
          this.recordEnvelopeHistory(dead);
          continue;
        }
        if (!isEnvelopeEligible(envelope.kind, actor.status)) {
          if (actor.status === ActorStatus.Stopped) {
            const dead = {
              ...envelope,
              status: EnvelopeStatus.DeadLettered,
              updatedAt: nowIso,
            } satisfies StoredEnvelope;
            this.updateEnvelope(dead);
            this.recordEnvelopeHistory(dead);
          }
          continue;
        }
        const active = this.db.prepare(`
          SELECT id FROM envelopes WHERE to_actor = ? AND status = ? LIMIT 1
        `).get(envelope.to, EnvelopeStatus.Processing) as { id: string } | undefined;
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
        this.updateEnvelope(claimedEnvelope);
        this.recordEnvelopeHistory(claimedEnvelope);
        return {
          claim: {
            envelopeId: envelope.id,
            actorId: actor.id,
            ownerId: options.ownerId,
            actorVersion: actor.version,
          },
          actor,
          envelope: claimedEnvelope,
        };
      }

      return undefined;
    });
  }

  async releaseOwnerClaims(ownerId: string, now: Date): Promise<number> {
    return this.inTransaction(() => {
      const nowIso = toIsoDateTimeString(now);
      const rows = this.db.prepare(`
        SELECT data FROM envelopes WHERE status = ? AND lease_owner = ?
      `).all(EnvelopeStatus.Processing, ownerId) as Array<{ data: string }>;
      let released = 0;
      for (const row of rows) {
        const envelope = JSON.parse(row.data) as StoredEnvelope;
        const next: StoredEnvelope = {
          ...envelope,
          status: EnvelopeStatus.Queued,
          leaseOwner: undefined,
          leaseUntil: undefined,
          updatedAt: nowIso,
        };
        this.updateEnvelope(next);
        this.recordEnvelopeHistory(next);
        released += 1;
      }
      return released;
    });
  }

  async commitActivation(claim: ActivationClaim, commit: ActivationCommit): Promise<void> {
    return this.inTransaction(() => {
      const actor = this.actorData(claim.actorId);
      const envelope = this.envelopeData(claim.envelopeId);
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
        const applied = this.applyActorCreate(create);
        if (applied === "noop") {
          const filtered = filterAppliedCreateEvents(commitEvents, create.actor.id, create.startEnvelope.id);
          commitEvents.length = 0;
          commitEvents.push(...filtered);
        } else if (applied === "restarted") {
          const filtered = filterAppliedCreateEvents(commitEvents, create.actor.id, create.startEnvelope.id, { keepEnvelopeCreated: true });
          commitEvents.length = 0;
          commitEvents.push(...filtered);
        }
      }
      for (const update of commit.actorUpdates) {
        const next = this.verifyAndApplyActorUpdate(update);
        this.recordActorHistory(next, claim.envelopeId);
      }
      for (const created of commit.envelopeCreates) {
        this.rejectDuplicateEnvelopeId(created.id);
        this.insertEnvelope(created);
        this.recordEnvelopeHistory(created);
      }
      for (const update of commit.envelopeUpdates) {
        if (update.id === claim.envelopeId) {
          throw new PersistenceConflictError(
            ActorErrorCode.PersistenceConflict,
            "Activation commits must not update the claimed envelope through envelopeUpdates",
          );
        }
        const next = this.verifyAndApplyEnvelopeUpdate(update);
        this.recordEnvelopeHistory(next);
      }
      this.insertRuntimeEvents(commitEvents);
      const completedEnvelope: StoredEnvelope = {
        ...envelope,
        status: commit.completeClaimedEnvelopeAs,
        leaseOwner: undefined,
        leaseUntil: undefined,
        updatedAt:
          commit.actorUpdates[0]?.updatedAt
          ?? commit.events[commit.events.length - 1]?.createdAt
          ?? envelope.updatedAt,
      };
      this.updateEnvelope(completedEnvelope);
      this.recordEnvelopeHistory(completedEnvelope);
    });
  }

  async failActivation(
    claim: ActivationClaim,
    failure: ActivationFailureCommit,
  ): Promise<void> {
    return this.inTransaction(() => {
      const actor = this.actorData(claim.actorId);
      const envelope = this.envelopeData(claim.envelopeId);
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

      const updatedActor = this.applyActorPatch(actor, failure.actorPatch, toIsoDateTimeString(failure.now));
      this.updateActor(updatedActor);
      this.recordActorHistory(updatedActor, claim.envelopeId);

      for (const update of failure.actorUpdates ?? []) {
        const next = this.verifyAndApplyActorUpdate(update);
        this.recordActorHistory(next, claim.envelopeId);
      }

      const failedEnvelope: StoredEnvelope = {
        ...envelope,
        attempt: envelope.attempt + 1,
        status: failure.failedEnvelopeStatus,
        leaseOwner: undefined,
        leaseUntil: undefined,
        updatedAt: toIsoDateTimeString(failure.now),
      };
      this.updateEnvelope(failedEnvelope);
      this.recordEnvelopeHistory(failedEnvelope);

      for (const created of failure.envelopeCreates) {
        this.rejectDuplicateEnvelopeId(created.id);
        this.insertEnvelope(created);
        this.recordEnvelopeHistory(created);
      }
      this.insertRuntimeEvents(failure.events);
    });
  }

  async requestStop(command: RequestStopCommand): Promise<void> {
    return this.inTransaction(() => {
      const actor = this.actorData(command.actorId);
      if (!actor) {
        throwVersionConflict(`Actor ${command.actorId} not found`);
      }
      if (actor.status === ActorStatus.Stopped) {
        return;
      }
      if (!command.expectedStatuses.includes(actor.status) && actor.status !== ActorStatus.Stopping) {
        throwVersionConflict(`Actor ${command.actorId} status conflict`);
      }

      const hasPendingStop = this.db.prepare(`
        SELECT id FROM envelopes
        WHERE to_actor = ? AND kind = ? AND status IN (?, ?)
        LIMIT 1
      `).get(
        actor.id,
        EnvelopeKind.LifecycleStop,
        EnvelopeStatus.Queued,
        EnvelopeStatus.Processing,
      ) as { id: string } | undefined;

      if (actor.status === ActorStatus.Stopping && hasPendingStop) {
        return;
      }

      this.rejectDuplicateEnvelopeId(command.stopEnvelope.id);

      if (actor.status !== ActorStatus.Stopping) {
        const nextActor: StoredActor = {
          ...actor,
          status: ActorStatus.Stopping,
          updatedAt: command.now,
          version: actor.version + 1,
        };
        this.updateActor(nextActor);
        this.recordActorHistory(nextActor, null);
        this.insertRuntimeEvents(command.events);
      } else {
        this.insertRuntimeEvents(
          command.events.filter((event) => event.type === RuntimeEventType.EnvelopeCreated),
        );
      }

      this.insertEnvelope(command.stopEnvelope);
      this.recordEnvelopeHistory(command.stopEnvelope);
    });
  }

  async releaseExpiredLeases(now: Date): Promise<number> {
    return this.inTransaction(() => {
      const nowIso = toIsoDateTimeString(now);
      const rows = this.db.prepare(`
        SELECT data FROM envelopes
        WHERE status = ? AND lease_until IS NOT NULL AND lease_until <= ?
      `).all(EnvelopeStatus.Processing, nowIso) as Array<{ data: string }>;
      let released = 0;
      for (const row of rows) {
        const envelope = JSON.parse(row.data) as StoredEnvelope;
        const next: StoredEnvelope = {
          ...envelope,
          status: EnvelopeStatus.Queued,
          leaseOwner: undefined,
          leaseUntil: undefined,
          updatedAt: nowIso,
        };
        this.updateEnvelope(next);
        this.recordEnvelopeHistory(next);
        released += 1;
      }
      return released;
    });
  }

  async readSnapshot(
    options?: PersistenceSnapshotOptions,
  ): Promise<PersistenceSnapshot> {
    const actors = (this.db.prepare("SELECT data FROM actors").all() as Array<{ data: string }>)
      .map((row) => JSON.parse(row.data) as StoredActor);

    const allEnvelopes = (this.db.prepare("SELECT data FROM envelopes ORDER BY updated_at, id").all() as Array<{ data: string }>)
      .map((row) => JSON.parse(row.data) as StoredEnvelope);
    const filtered = allEnvelopes.filter((envelope) => {
      if (!options?.includeCompletedEnvelopes && envelope.status === EnvelopeStatus.Completed) {
        return false;
      }
      if (!options?.includeDroppedEnvelopes && envelope.status === EnvelopeStatus.Dropped) {
        return false;
      }
      return true;
    });

    const completedLimit = options?.completedEnvelopeLimit;
    const envelopes = completedLimit === undefined
      ? filtered
      : filtered.filter((envelope, _, current) => {
        if (envelope.status !== EnvelopeStatus.Completed) {
          return true;
        }
        const completed = current.filter((candidate) => candidate.status === EnvelopeStatus.Completed);
        return completed.slice(-completedLimit).some((candidate) => candidate.id === envelope.id);
      });

    let events: StoredRuntimeEvent[] = [];
    if (options?.includeEvents) {
      if (options.eventLimit === undefined) {
        events = (this.db.prepare("SELECT data FROM runtime_events ORDER BY created_at").all() as Array<{ data: string }>)
          .map(parseEvent);
      } else {
        events = (this.db.prepare(`
          SELECT data FROM (
            SELECT data, created_at FROM runtime_events ORDER BY created_at DESC LIMIT ?
          ) ORDER BY created_at ASC
        `).all(options.eventLimit) as Array<{ data: string }>).map(parseEvent);
      }
    }

    return {
      takenAt: toIsoDateTimeString(this.clock.now()),
      actors,
      envelopes,
      events,
    };
  }

  /** Read actor state history (for debugging/testing). Not part of ActorPersistence interface. */
  readActorHistory(actorId: string): Array<{
    actor_id: string;
    version: number;
    status: string;
    envelope_id: string | null;
    data: StoredActor;
    recorded_at: string;
  }> {
    const rows = this.db.prepare(`
      SELECT actor_id, version, status, envelope_id, data, recorded_at
      FROM actor_state_history
      WHERE actor_id = ?
      ORDER BY version, rowid
    `).all(actorId) as ActorHistoryRow[];
    return rows.map((row) => ({
      ...row,
      data: JSON.parse(row.data) as StoredActor,
    }));
  }

  /** Read envelope history (for debugging/testing). Not part of ActorPersistence interface. */
  readEnvelopeHistory(envelopeId: string): Array<{
    envelope_id: string;
    status: string;
    data: StoredEnvelope;
    recorded_at: string;
  }> {
    const rows = this.db.prepare(`
      SELECT envelope_id, status, data, recorded_at
      FROM envelope_history
      WHERE envelope_id = ?
      ORDER BY rowid
    `).all(envelopeId) as EnvelopeHistoryRow[];
    return rows.map((row) => ({
      ...row,
      data: JSON.parse(row.data) as StoredEnvelope,
    }));
  }
}