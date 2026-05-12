import Database from 'better-sqlite3';
import { exponentialBackoffMilliseconds, plusMilliseconds, toIsoUtcString } from './clock';
import { ConcurrencyError, NotFoundError } from './errors';
import { parseJson, stringifyJson } from './json';
import { SQLITE_PRAGMAS, SQLITE_SCHEMA } from './schema';
export class SqlitePersistence {
    db;
    constructor(options = {}) {
        this.db = options.database ?? new Database(options.filename ?? ':memory:');
        this.applyPragmas();
    }
    async migrate() {
        for (const statement of SQLITE_SCHEMA) {
            this.db.exec(statement);
        }
    }
    async upsertActor(input) {
        const nowIso = new Date().toISOString();
        this.db
            .prepare(`INSERT INTO actors (id, kind, status, state_json, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   kind = excluded.kind,
				   status = excluded.status,
				   state_json = excluded.state_json,
				   updated_at = excluded.updated_at`)
            .run(input.id, input.kind, input.status ?? 'active', stringifyJson(input.state ?? {}), nowIso, nowIso);
    }
    async ensureActorExists(input) {
        const nowIso = new Date().toISOString();
        this.db
            .prepare(`INSERT INTO actors (id, kind, status, state_json, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO NOTHING`)
            .run(input.id, input.kind, input.status ?? 'active', stringifyJson(input.state ?? {}), nowIso, nowIso);
    }
    async getActor(id) {
        const row = this.db.prepare('SELECT * FROM actors WHERE id = ?').get(id);
        return row ? mapActorRow(row) : null;
    }
    async enqueue(envelope) {
        this.withTransaction(() => {
            const insertedEnvelope = insertEnvelope(this.db, envelope);
            insertStreamEvents(this.db, [
                ...buildEnvelopeQueuedStreamEvents({ envelope: insertedEnvelope, now: insertedEnvelope.createdAt })
            ]);
        });
    }
    async claimNext(input) {
        if (input.leaseMs <= 0) {
            throw new RangeError('leaseMs must be greater than zero');
        }
        return this.withImmediateTransaction(() => {
            const nowIso = input.now.toISOString();
            const lockedUntilIso = plusMilliseconds(input.now, input.leaseMs).toISOString();
            const envelopeRow = this.db
                .prepare(`SELECT e.*
					 FROM envelopes e
					 LEFT JOIN actor_locks l
					   ON l.actor_id = e.to_actor
					  AND l.locked_until >= ?
					 WHERE e.status = 'queued'
					   AND e.available_at <= ?
					   AND l.actor_id IS NULL
					 ORDER BY e.available_at ASC, e.created_at ASC
					 LIMIT 1`)
                .get(nowIso, nowIso);
            if (!envelopeRow) {
                return null;
            }
            const actorKind = inferActorKind(envelopeRow.to_actor);
            this.db
                .prepare(`INSERT INTO actors (id, kind, status, state_json, created_at, updated_at)
					 VALUES (?, ?, 'active', '{}', ?, ?)
					 ON CONFLICT(id) DO NOTHING`)
                .run(envelopeRow.to_actor, actorKind, nowIso, nowIso);
            const envelopeUpdate = this.db
                .prepare(`UPDATE envelopes
					 SET status = 'processing',
					     attempts = attempts + 1,
					     locked_by = ?,
					     locked_until = ?,
					     updated_at = ?
					 WHERE id = ?
					   AND status = 'queued'`)
                .run(input.workerId, lockedUntilIso, nowIso, envelopeRow.id);
            if (envelopeUpdate.changes !== 1) {
                throw new ConcurrencyError(`Failed to claim envelope ${envelopeRow.id}`);
            }
            this.db
                .prepare(`INSERT INTO actor_locks (actor_id, envelope_id, locked_by, locked_until)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(actor_id) DO UPDATE SET
					   envelope_id = excluded.envelope_id,
					   locked_by = excluded.locked_by,
					   locked_until = excluded.locked_until`)
                .run(envelopeRow.to_actor, envelopeRow.id, input.workerId, lockedUntilIso);
            const claimedEnvelope = this.db
                .prepare('SELECT * FROM envelopes WHERE id = ?')
                .get(envelopeRow.id);
            insertStreamEvents(this.db, buildEnvelopeClaimedStreamEvents({
                envelope: mapEnvelopeRow(claimedEnvelope),
                workerId: input.workerId,
                now: nowIso
            }));
            const actorRow = this.db
                .prepare('SELECT * FROM actors WHERE id = ?')
                .get(envelopeRow.to_actor);
            return {
                envelope: mapEnvelopeRow(claimedEnvelope),
                actor: mapActorRow(actorRow)
            };
        });
    }
    async commitActivation(input) {
        this.withTransaction(() => {
            const nowIso = input.now.toISOString();
            const envelopeRow = this.db
                .prepare('SELECT * FROM envelopes WHERE id = ?')
                .get(input.envelopeId);
            if (!envelopeRow) {
                throw new NotFoundError(`Envelope ${input.envelopeId} not found`);
            }
            if (envelopeRow.status !== 'processing') {
                throw new ConcurrencyError(`Envelope ${input.envelopeId} is not processing`);
            }
            if (envelopeRow.locked_by !== input.workerId) {
                throw new ConcurrencyError(`Envelope ${input.envelopeId} is not locked by ${input.workerId}`);
            }
            const actorLock = this.db
                .prepare('SELECT actor_id, envelope_id, locked_by FROM actor_locks WHERE actor_id = ?')
                .get(input.actorId);
            if (!actorLock || actorLock.envelope_id !== input.envelopeId || actorLock.locked_by !== input.workerId) {
                throw new ConcurrencyError(`Actor ${input.actorId} is not locked for envelope ${input.envelopeId}`);
            }
            const actorRow = this.db
                .prepare('SELECT * FROM actors WHERE id = ?')
                .get(input.actorId);
            if (!actorRow) {
                throw new NotFoundError(`Actor ${input.actorId} not found`);
            }
            if (actorRow.version !== input.expectedActorVersion) {
                throw new ConcurrencyError(`Actor ${input.actorId} version mismatch: expected ${input.expectedActorVersion}, got ${actorRow.version}`);
            }
            this.db
                .prepare(`UPDATE actors
					 SET state_json = ?,
					     version = version + 1,
					     updated_at = ?
					 WHERE id = ?`)
                .run(stringifyJson(input.newActorState), nowIso, input.actorId);
            const insertEvent = this.db.prepare(`INSERT INTO actor_events (id, actor_id, envelope_id, event_type, event_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`);
            for (const event of input.events) {
                const normalizedEvent = normalizeActorEventInput({
                    event,
                    actorId: input.actorId,
                    envelopeId: input.envelopeId,
                    now: input.now
                });
                insertEvent.run(normalizedEvent.id, normalizedEvent.actorId, normalizedEvent.envelopeId, normalizedEvent.eventType, stringifyJson(normalizedEvent.event), normalizedEvent.createdAt);
            }
            const previousActor = mapActorRow(actorRow);
            const inputEnvelope = mapEnvelopeRow(envelopeRow);
            const outgoingEnvelopes = [];
            for (const outgoingEnvelope of input.outgoing) {
                outgoingEnvelopes.push(insertEnvelope(this.db, outgoingEnvelope, input.now));
            }
            this.db
                .prepare(`UPDATE envelopes
					 SET status = 'done',
					     locked_by = NULL,
					     locked_until = NULL,
					     updated_at = ?
					 WHERE id = ?`)
                .run(nowIso, input.envelopeId);
            this.db
                .prepare('DELETE FROM actor_locks WHERE actor_id = ? AND envelope_id = ?')
                .run(input.actorId, input.envelopeId);
            insertStreamEvents(this.db, buildCommitStreamEvents({
                actor: previousActor,
                newActorState: input.newActorState,
                inputEnvelope,
                actorEvents: input.events.map((event) => normalizeActorEventInput({
                    event,
                    actorId: input.actorId,
                    envelopeId: input.envelopeId,
                    now: input.now
                })),
                outgoingEnvelopes,
                now: nowIso
            }));
        });
    }
    async failActivation(input) {
        this.withTransaction(() => {
            const envelopeRow = this.db
                .prepare('SELECT * FROM envelopes WHERE id = ?')
                .get(input.envelopeId);
            if (!envelopeRow) {
                throw new NotFoundError(`Envelope ${input.envelopeId} not found`);
            }
            if (envelopeRow.status !== 'processing') {
                throw new ConcurrencyError(`Envelope ${input.envelopeId} is not processing`);
            }
            if (envelopeRow.locked_by !== input.workerId) {
                throw new ConcurrencyError(`Envelope ${input.envelopeId} is not locked by ${input.workerId}`);
            }
            const nowIso = input.now.toISOString();
            const exhausted = envelopeRow.attempts >= envelopeRow.max_attempts;
            const nextAvailableAt = exhausted
                ? envelopeRow.available_at
                : (input.retryAt ?? plusMilliseconds(input.now, exponentialBackoffMilliseconds(envelopeRow.attempts))).toISOString();
            this.db
                .prepare(`UPDATE envelopes
					 SET status = ?,
					     available_at = ?,
					     locked_by = NULL,
					     locked_until = NULL,
					     last_error = ?,
					     updated_at = ?
					 WHERE id = ?`)
                .run(exhausted ? 'dead' : 'queued', nextAvailableAt, input.error, nowIso, input.envelopeId);
            this.db
                .prepare('DELETE FROM actor_locks WHERE actor_id = ? AND envelope_id = ?')
                .run(envelopeRow.to_actor, input.envelopeId);
            insertStreamEvents(this.db, buildEnvelopeFailedStreamEvents({
                envelope: mapEnvelopeRow({
                    ...envelopeRow,
                    status: exhausted ? 'dead' : 'queued',
                    available_at: nextAvailableAt,
                    locked_by: null,
                    locked_until: null,
                    last_error: input.error,
                    updated_at: nowIso
                }),
                error: input.error,
                now: nowIso
            }));
        });
    }
    async releaseExpiredLocks(now) {
        return this.withTransaction(() => {
            const nowIso = now.toISOString();
            const staleEnvelopes = this.db
                .prepare(`SELECT * FROM envelopes
					 WHERE status = 'processing'
					   AND locked_until IS NOT NULL
					   AND locked_until < ?`)
                .all(nowIso);
            const updateEnvelope = this.db.prepare(`UPDATE envelopes
				 SET status = ?,
				     available_at = ?,
				     locked_by = NULL,
				     locked_until = NULL,
				     updated_at = ?
				 WHERE id = ?`);
            const deleteLock = this.db.prepare('DELETE FROM actor_locks WHERE envelope_id = ?');
            for (const envelope of staleEnvelopes) {
                const exhausted = envelope.attempts >= envelope.max_attempts;
                updateEnvelope.run(exhausted ? 'dead' : 'queued', nowIso, nowIso, envelope.id);
                deleteLock.run(envelope.id);
            }
            return staleEnvelopes.length;
        });
    }
    async replaceSkills(skills, now) {
        this.withTransaction(() => {
            this.db.prepare('DELETE FROM skills').run();
            const insertSkill = this.db.prepare(`INSERT INTO skills (id, path, frontmatter_json, body, body_hash, loaded_at)
				 VALUES (?, ?, ?, ?, ?, ?)`);
            for (const skill of skills) {
                insertSkill.run(skill.id, skill.path, stringifyJson(skill.frontmatter), skill.body, skill.bodyHash, now.toISOString());
            }
        });
    }
    async listSkills() {
        const rows = this.db.prepare('SELECT * FROM skills ORDER BY path ASC').all();
        return rows.map((row) => ({
            id: row.id,
            path: row.path,
            frontmatter: parseJson(row.frontmatter_json),
            body: row.body,
            bodyHash: row.body_hash,
            loadedAt: row.loaded_at
        }));
    }
    async listIntents() {
        const rows = this.db
            .prepare(`SELECT * FROM actors WHERE kind = 'intent' ORDER BY created_at DESC`)
            .all();
        return rows.map((row) => ({
            id: extractIntentId(row.id),
            state: parseJson(row.state_json),
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    async getIntent(intentId) {
        const row = this.db.prepare(`SELECT * FROM actors WHERE id = ? AND kind = 'intent'`).get(`intent/${intentId}`);
        if (!row) {
            return null;
        }
        return {
            id: intentId,
            state: parseJson(row.state_json),
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    async listStreamEvents(input) {
        const rows = this.db
            .prepare(`SELECT * FROM stream_events
				 WHERE scope = ?
				   AND seq > ?
				 ORDER BY seq ASC
				 LIMIT ?`)
            .all(input.scope, input.after ?? 0, input.limit ?? 200);
        return rows.map(mapStreamEventRow);
    }
    applyPragmas() {
        for (const pragma of SQLITE_PRAGMAS) {
            this.db.exec(pragma);
        }
    }
    withTransaction(callback) {
        this.db.exec('BEGIN');
        try {
            const result = callback();
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    withImmediateTransaction(callback) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = callback();
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}
function inferActorKind(actorId) {
    const [kind] = actorId.split('/', 1);
    return kind && kind.length > 0 ? kind : 'unknown';
}
function insertEnvelope(db, envelope, now = new Date()) {
    const createdAtIso = toIsoUtcString(envelope.createdAt, now);
    const availableAtIso = toIsoUtcString(envelope.availableAt, now);
    db.prepare(`INSERT INTO envelopes (
		  id,
		  from_actor,
		  to_actor,
		  type,
		  correlation_id,
		  causation_id,
		  payload_json,
		  status,
		  available_at,
		  attempts,
		  max_attempts,
		  locked_by,
		  locked_until,
		  last_error,
		  created_at,
		  updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, NULL, NULL, NULL, ?, ?)`).run(envelope.id, envelope.fromActor, envelope.toActor, envelope.type, envelope.correlationId, envelope.causationId ?? null, stringifyJson(envelope.payload), availableAtIso, envelope.maxAttempts ?? 5, createdAtIso, createdAtIso);
    return {
        id: envelope.id,
        fromActor: envelope.fromActor,
        toActor: envelope.toActor,
        type: envelope.type,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId ?? null,
        payload: envelope.payload,
        status: 'queued',
        availableAt: availableAtIso,
        attempts: 0,
        maxAttempts: envelope.maxAttempts ?? 5,
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
        createdAt: createdAtIso,
        updatedAt: createdAtIso
    };
}
function mapActorRow(row) {
    return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        state: parseJson(row.state_json),
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function mapEnvelopeRow(row) {
    return {
        id: row.id,
        fromActor: row.from_actor,
        toActor: row.to_actor,
        type: row.type,
        correlationId: row.correlation_id,
        causationId: row.causation_id,
        payload: parseJson(row.payload_json),
        status: row.status,
        availableAt: row.available_at,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        lockedBy: row.locked_by,
        lockedUntil: row.locked_until,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function mapStreamEventRow(row) {
    return {
        seq: row.seq,
        id: row.id,
        scope: row.scope,
        actorId: row.actor_id,
        envelopeId: row.envelope_id,
        type: row.type,
        payload: parseJson(row.payload_json),
        createdAt: row.created_at
    };
}
function insertStreamEvents(db, events) {
    if (events.length === 0) {
        return;
    }
    const insert = db.prepare(`INSERT INTO stream_events (id, scope, actor_id, envelope_id, type, payload_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const event of events) {
        insert.run(event.id, event.scope, event.actorId ?? null, event.envelopeId ?? null, event.type, stringifyJson(event.payload), event.createdAt);
    }
}
function buildEnvelopeQueuedStreamEvents(input) {
    return scopedStreamEvents({
        baseId: `${input.envelope.id}:queued`,
        actorId: input.envelope.toActor,
        envelopeId: input.envelope.id,
        type: 'runtime.envelope.queued',
        payload: {
            envelopeId: input.envelope.id,
            fromActor: input.envelope.fromActor,
            toActor: input.envelope.toActor,
            envelopeType: input.envelope.type,
            correlationId: input.envelope.correlationId
        },
        createdAt: input.now,
        scopes: scopesForEnvelope(input.envelope)
    });
}
function buildEnvelopeClaimedStreamEvents(input) {
    return scopedStreamEvents({
        baseId: `${input.envelope.id}:claimed`,
        actorId: input.envelope.toActor,
        envelopeId: input.envelope.id,
        type: 'runtime.envelope.claimed',
        payload: {
            envelopeId: input.envelope.id,
            actorId: input.envelope.toActor,
            workerId: input.workerId,
            attempts: input.envelope.attempts
        },
        createdAt: input.now,
        scopes: scopesForEnvelope(input.envelope)
    });
}
function buildEnvelopeFailedStreamEvents(input) {
    return scopedStreamEvents({
        baseId: `${input.envelope.id}:failed`,
        actorId: input.envelope.toActor,
        envelopeId: input.envelope.id,
        type: 'runtime.envelope.failed',
        payload: {
            envelopeId: input.envelope.id,
            actorId: input.envelope.toActor,
            error: input.error,
            status: input.envelope.status
        },
        createdAt: input.now,
        scopes: scopesForEnvelope(input.envelope)
    });
}
function buildCommitStreamEvents(input) {
    const streamEvents = [];
    streamEvents.push(...scopedStreamEvents({
        baseId: `${input.inputEnvelope.id}:completed`,
        actorId: input.actor.id,
        envelopeId: input.inputEnvelope.id,
        type: 'runtime.envelope.completed',
        payload: {
            envelopeId: input.inputEnvelope.id,
            actorId: input.actor.id,
            envelopeType: input.inputEnvelope.type,
            correlationId: input.inputEnvelope.correlationId
        },
        createdAt: input.now,
        scopes: scopesForStreamEvent({
            actorId: input.actor.id,
            correlationId: input.inputEnvelope.correlationId,
            intentId: inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload)
        })
    }));
    for (const actorEvent of input.actorEvents) {
        streamEvents.push(...scopedStreamEvents({
            baseId: `${actorEvent.id}:actor`,
            actorId: actorEvent.actorId,
            envelopeId: actorEvent.envelopeId ?? input.inputEnvelope.id,
            type: 'actor.event',
            payload: {
                actorId: actorEvent.actorId,
                eventType: actorEvent.eventType,
                event: actorEvent.event
            },
            createdAt: toIsoUtcString(actorEvent.createdAt, input.now),
            scopes: scopesForStreamEvent({
                actorId: actorEvent.actorId,
                correlationId: input.inputEnvelope.correlationId,
                intentId: inferIntentId(actorEvent.actorId, input.newActorState, actorEvent.event)
            })
        }));
    }
    for (const outgoing of input.outgoingEnvelopes) {
        streamEvents.push(...buildEnvelopeQueuedStreamEvents({ envelope: outgoing, now: input.now }));
    }
    const previousIntentState = input.actor.kind === 'intent' ? toIntentState(input.actor.state) : null;
    const nextIntentState = input.actor.kind === 'intent' ? toIntentState(input.newActorState) : null;
    const intentId = inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload);
    if (input.actor.kind === 'intent' && intentId && input.inputEnvelope.type === 'intent.start' && input.actor.version === 0) {
        streamEvents.push(...scopedStreamEvents({
            baseId: `${input.inputEnvelope.id}:intent-created`,
            actorId: input.actor.id,
            envelopeId: input.inputEnvelope.id,
            type: 'intent.created',
            payload: {
                intentId,
                title: nextIntentState?.title,
                goal: nextIntentState?.goal,
                status: nextIntentState?.status,
                summary: nextIntentState?.summary
            },
            createdAt: input.now,
            scopes: scopesForStreamEvent({ actorId: input.actor.id, correlationId: input.inputEnvelope.correlationId, intentId })
        }));
    }
    if (input.actor.kind === 'intent' &&
        intentId &&
        nextIntentState &&
        (!previousIntentState ||
            previousIntentState.status !== nextIntentState.status ||
            previousIntentState.summary !== nextIntentState.summary)) {
        streamEvents.push(...scopedStreamEvents({
            baseId: `${input.inputEnvelope.id}:intent-status`,
            actorId: input.actor.id,
            envelopeId: input.inputEnvelope.id,
            type: 'intent.status_changed',
            payload: {
                intentId,
                status: nextIntentState.status,
                summary: nextIntentState.summary,
                title: nextIntentState.title
            },
            createdAt: input.now,
            scopes: scopesForStreamEvent({ actorId: input.actor.id, correlationId: input.inputEnvelope.correlationId, intentId })
        }));
    }
    if (input.actor.kind === 'intent' && intentId) {
        for (const outgoing of input.outgoingEnvelopes) {
            if (outgoing.type === 'skill.request') {
                streamEvents.push(...scopedStreamEvents({
                    baseId: `${outgoing.id}:skill-call-started`,
                    actorId: input.actor.id,
                    envelopeId: outgoing.id,
                    type: 'intent.skill_call_started',
                    payload: {
                        intentId,
                        callId: readString(outgoing.payload?.callId),
                        skillId: parseSkillId(outgoing.toActor),
                        request: readString(outgoing.payload?.request)
                    },
                    createdAt: input.now,
                    scopes: scopesForStreamEvent({
                        actorId: input.actor.id,
                        correlationId: outgoing.correlationId,
                        intentId: inferIntentId(input.actor.id, input.newActorState, outgoing.payload)
                    })
                }));
            }
            if (outgoing.toActor === 'human' && (outgoing.type === 'human.message' || outgoing.type === 'human.question')) {
                streamEvents.push(...scopedStreamEvents({
                    baseId: `${outgoing.id}:message-to-user`,
                    actorId: input.actor.id,
                    envelopeId: outgoing.id,
                    type: 'intent.message_to_user',
                    payload: {
                        intentId,
                        messageType: outgoing.type,
                        ...(typeof outgoing.payload === 'object' && outgoing.payload ? outgoing.payload : {})
                    },
                    createdAt: input.now,
                    scopes: scopesForStreamEvent({
                        actorId: input.actor.id,
                        correlationId: outgoing.correlationId,
                        intentId: inferIntentId(input.actor.id, input.newActorState, outgoing.payload)
                    })
                }));
            }
        }
        if (input.inputEnvelope.type === 'skill.result' ||
            input.inputEnvelope.type === 'skill.failed' ||
            input.inputEnvelope.type === 'skill.needs_clarification') {
            const payload = typeof input.inputEnvelope.payload === 'object' && input.inputEnvelope.payload ? input.inputEnvelope.payload : {};
            streamEvents.push(...scopedStreamEvents({
                baseId: `${input.inputEnvelope.id}:skill-call-completed`,
                actorId: input.actor.id,
                envelopeId: input.inputEnvelope.id,
                type: 'intent.skill_call_completed',
                payload: {
                    intentId,
                    messageType: input.inputEnvelope.type,
                    ...payload
                },
                createdAt: input.now,
                scopes: scopesForStreamEvent({ actorId: input.actor.id, correlationId: input.inputEnvelope.correlationId, intentId })
            }));
        }
    }
    const supervisorIntentId = inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload);
    if (input.actor.kind === 'skill-supervisor') {
        for (const outgoing of input.outgoingEnvelopes) {
            if (outgoing.toActor.startsWith('skill-worker/')) {
                const type = hasInitialState(outgoing.payload) ? 'skill.worker_spawned' : 'skill.worker_routed';
                streamEvents.push(...scopedStreamEvents({
                    baseId: `${outgoing.id}:${type}`,
                    actorId: input.actor.id,
                    envelopeId: outgoing.id,
                    type,
                    payload: {
                        skillId: parseSkillId(input.actor.id),
                        workerActorId: outgoing.toActor,
                        workerId: parseWorkerId(outgoing.toActor)
                    },
                    createdAt: input.now,
                    scopes: scopesForStreamEvent({
                        actorId: input.actor.id,
                        correlationId: outgoing.correlationId,
                        intentId: inferIntentId(outgoing.toActor, input.newActorState, outgoing.payload) ?? supervisorIntentId
                    })
                }));
            }
        }
        if (input.inputEnvelope.type === 'skill.worker.result') {
            streamEvents.push(...scopedStreamEvents({
                baseId: `${input.inputEnvelope.id}:worker-completed`,
                actorId: input.actor.id,
                envelopeId: input.inputEnvelope.id,
                type: 'skill.worker_completed',
                payload: typeof input.inputEnvelope.payload === 'object' && input.inputEnvelope.payload ? input.inputEnvelope.payload : {},
                createdAt: input.now,
                scopes: scopesForStreamEvent({
                    actorId: input.actor.id,
                    correlationId: input.inputEnvelope.correlationId,
                    intentId: inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload) ?? supervisorIntentId
                })
            }));
        }
    }
    return streamEvents;
}
function scopedStreamEvents(input) {
    return [...new Set(input.scopes)].map((scope) => ({
        id: `${input.baseId}:${scope}`,
        scope,
        actorId: input.actorId ?? null,
        envelopeId: input.envelopeId ?? null,
        type: input.type,
        payload: input.payload,
        createdAt: input.createdAt
    }));
}
function scopesForEnvelope(envelope) {
    return scopesForStreamEvent({
        actorId: envelope.toActor,
        correlationId: envelope.correlationId,
        intentId: inferIntentId(envelope.toActor, envelope.payload, envelope.payload)
    });
}
function scopesForStreamEvent(input) {
    return [
        'global',
        input.actorId ? `actor/${input.actorId}` : null,
        input.correlationId ? `correlation/${input.correlationId}` : null,
        input.intentId ? `intent/${input.intentId}` : null
    ].filter((value) => Boolean(value));
}
function inferIntentId(actorId, state, payload) {
    if (actorId?.startsWith('intent/')) {
        return extractIntentId(actorId);
    }
    const candidate = readIntentIdFromUnknown(payload) ??
        readIntentIdFromUnknown(state);
    if (candidate) {
        return candidate;
    }
    return null;
}
function normalizeActorEventInput(input) {
    return {
        ...input.event,
        id: input.event.id ?? crypto.randomUUID(),
        actorId: input.event.actorId ?? input.actorId,
        envelopeId: input.event.envelopeId ?? input.envelopeId,
        createdAt: toIsoUtcString(input.event.createdAt, input.now)
    };
}
function readIntentIdFromUnknown(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    if (typeof record.intentId === 'string' && record.intentId.length > 0) {
        return record.intentId;
    }
    for (const key of ['result', 'input', 'call']) {
        const nested = readIntentIdFromUnknown(record[key]);
        if (nested) {
            return nested;
        }
    }
    return null;
}
function extractIntentId(actorId) {
    return actorId.startsWith('intent/') ? actorId.slice('intent/'.length) : actorId;
}
function parseSkillId(actorId) {
    if (!actorId?.startsWith('skill/')) {
        return null;
    }
    return actorId.slice('skill/'.length) || null;
}
function parseWorkerId(actorId) {
    if (!actorId.startsWith('skill-worker/')) {
        return null;
    }
    const parts = actorId.split('/');
    return parts[2] ?? null;
}
function hasInitialState(payload) {
    return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && 'initialState' in payload);
}
function toIntentState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return null;
    }
    return state;
}
function readString(value) {
    return typeof value === 'string' ? value : null;
}
