import { randomUUID } from 'node:crypto'

import { Database } from 'bun:sqlite'

import { exponentialBackoffMilliseconds, plusMilliseconds, toIsoUtcString } from './clock'
import { ConcurrencyError, NotFoundError } from './errors'
import { parseJson, stringifyJson } from './json'
import { SQLITE_PRAGMAS, SQLITE_SCHEMA } from './schema'
import type {
	ActorEventInput,
	ActorRecord,
	ClaimedEnvelope,
	EnvelopeInput,
	EnvelopeRecord,
	Persistence,
	SkillRecord,
	SkillRecordInput,
	StreamEventRecord
} from './types'

type ActorRow = {
	id: string
	kind: string
	status: ActorRecord['status']
	state_json: string
	version: number
	created_at: string
	updated_at: string
}

type EnvelopeRow = {
	id: string
	from_actor: string
	to_actor: string
	type: string
	correlation_id: string
	causation_id: string | null
	payload_json: string
	status: EnvelopeRecord['status']
	available_at: string
	attempts: number
	max_attempts: number
	locked_by: string | null
	locked_until: string | null
	last_error: string | null
	created_at: string
	updated_at: string
}

type SkillRow = {
	id: string
	path: string
	frontmatter_json: string
	body: string
	body_hash: string
	loaded_at: string
}

type StreamEventRow = {
	seq: number
	id: string
	scope: string
	actor_id: string | null
	envelope_id: string | null
	type: string
	payload_json: string
	created_at: string
}

export interface SqlitePersistenceOptions {
	filename?: string
	database?: SqliteDatabase
}

type SqliteDatabase = Pick<Database, 'exec' | 'query'>

type SqliteStatement = ReturnType<Database['query']>

type RunResult = {
	changes: number
	lastInsertRowid: number | bigint
}

export class SqlitePersistence implements Persistence {
	readonly db: SqliteDatabase

	constructor(options: SqlitePersistenceOptions = {}) {
		this.db = options.database ?? new Database(options.filename ?? ':memory:')
		this.applyPragmas()
	}

	async migrate(): Promise<void> {
		for (const statement of SQLITE_SCHEMA) {
			this.db.exec(statement)
		}
	}

	async upsertActor(input: {
		id: string
		kind: string
		status?: ActorRecord['status']
		state?: unknown
	}): Promise<void> {
		const nowIso = new Date().toISOString()
		query(
			this.db,
				`INSERT INTO actors (id, kind, status, state_json, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   kind = excluded.kind,
				   status = excluded.status,
				   state_json = excluded.state_json,
				   updated_at = excluded.updated_at`
			)
			.run(
				input.id,
				input.kind,
				input.status ?? 'active',
				stringifyJson(input.state ?? {}),
				nowIso,
				nowIso
			)
	}

	async ensureActorExists(input: {
		id: string
		kind: string
		status?: ActorRecord['status']
		state?: unknown
	}): Promise<void> {
		const nowIso = new Date().toISOString()
		query(
			this.db,
				`INSERT INTO actors (id, kind, status, state_json, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO NOTHING`
			)
			.run(
				input.id,
				input.kind,
				input.status ?? 'active',
				stringifyJson(input.state ?? {}),
				nowIso,
				nowIso
			)
	}

	async getActor(id: string): Promise<ActorRecord | null> {
		const row = query(this.db, 'SELECT * FROM actors WHERE id = ?').get(id) as ActorRow | undefined
		return row ? mapActorRow(row) : null
	}

	async enqueue(envelope: EnvelopeInput): Promise<void> {
		this.withTransaction(() => {
			const insertedEnvelope = insertEnvelope(this.db, envelope)
			insertStreamEvents(this.db, [
				...buildEnvelopeQueuedStreamEvents({ envelope: insertedEnvelope, now: insertedEnvelope.createdAt })
			])
		})
	}

	async claimNext(input: {
		workerId: string
		leaseMs: number
		now: Date
	}): Promise<ClaimedEnvelope | null> {
		if (input.leaseMs <= 0) {
			throw new RangeError('leaseMs must be greater than zero')
		}

		return this.withImmediateTransaction(() => {
			const nowIso = input.now.toISOString()
			const lockedUntilIso = plusMilliseconds(input.now, input.leaseMs).toISOString()

			const envelopeRow = query(
				this.db,
					`SELECT e.*
					 FROM envelopes e
					 LEFT JOIN actor_locks l
					   ON l.actor_id = e.to_actor
					  AND l.locked_until >= ?
					 WHERE e.status = 'queued'
					   AND e.available_at <= ?
					   AND l.actor_id IS NULL
					 ORDER BY e.available_at ASC, e.created_at ASC
					 LIMIT 1`
				)
				.get(nowIso, nowIso) as EnvelopeRow | undefined

			if (!envelopeRow) {
				return null
			}

			const actorKind = inferActorKind(envelopeRow.to_actor)
			const initialActorState = inferInitialActorState({
				actorId: envelopeRow.to_actor,
				envelopeType: envelopeRow.type,
				payload: parseJson(envelopeRow.payload_json)
			})
			query(
				this.db,
					`INSERT INTO actors (id, kind, status, state_json, created_at, updated_at)
					 VALUES (?, ?, 'active', ?, ?, ?)
					 ON CONFLICT(id) DO NOTHING`
				)
				.run(envelopeRow.to_actor, actorKind, stringifyJson(initialActorState), nowIso, nowIso)

			const envelopeUpdate = query(
				this.db,
					`UPDATE envelopes
					 SET status = 'processing',
					     attempts = attempts + 1,
					     locked_by = ?,
					     locked_until = ?,
					     updated_at = ?
					 WHERE id = ?
					   AND status = 'queued'`
				)
				.run(input.workerId, lockedUntilIso, nowIso, envelopeRow.id)

			if (envelopeUpdate.changes !== 1) {
				throw new ConcurrencyError(`Failed to claim envelope ${envelopeRow.id}`)
			}

			query(
				this.db,
					`INSERT INTO actor_locks (actor_id, envelope_id, locked_by, locked_until)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(actor_id) DO UPDATE SET
					   envelope_id = excluded.envelope_id,
					   locked_by = excluded.locked_by,
					   locked_until = excluded.locked_until`
				)
				.run(envelopeRow.to_actor, envelopeRow.id, input.workerId, lockedUntilIso)

			const claimedEnvelope = query(this.db, 'SELECT * FROM envelopes WHERE id = ?')
				.get(envelopeRow.id) as EnvelopeRow

			insertStreamEvents(this.db, buildEnvelopeClaimedStreamEvents({
				envelope: mapEnvelopeRow(claimedEnvelope),
				workerId: input.workerId,
				now: nowIso
			}))

			const actorRow = query(this.db, 'SELECT * FROM actors WHERE id = ?')
				.get(envelopeRow.to_actor) as ActorRow

			return {
				envelope: mapEnvelopeRow(claimedEnvelope),
				actor: mapActorRow(actorRow)
			}
		})
	}

	async commitActivation(input: {
		workerId: string
		envelopeId: string
		actorId: string
		expectedActorVersion: number
		newActorState: unknown
		events: ActorEventInput[]
		outgoing: EnvelopeInput[]
		now: Date
	}): Promise<void> {
		this.withTransaction(() => {
			const nowIso = input.now.toISOString()
			const envelopeRow = query(this.db, 'SELECT * FROM envelopes WHERE id = ?')
				.get(input.envelopeId) as EnvelopeRow | undefined

			if (!envelopeRow) {
				throw new NotFoundError(`Envelope ${input.envelopeId} not found`)
			}

			if (envelopeRow.status !== 'processing') {
				throw new ConcurrencyError(`Envelope ${input.envelopeId} is not processing`)
			}

			if (envelopeRow.locked_by !== input.workerId) {
				throw new ConcurrencyError(`Envelope ${input.envelopeId} is not locked by ${input.workerId}`)
			}

			const actorLock = query(
				this.db,
					'SELECT actor_id, envelope_id, locked_by FROM actor_locks WHERE actor_id = ?'
				)
				.get(input.actorId) as
				| { actor_id: string; envelope_id: string; locked_by: string }
				| undefined

			if (!actorLock || actorLock.envelope_id !== input.envelopeId || actorLock.locked_by !== input.workerId) {
				throw new ConcurrencyError(`Actor ${input.actorId} is not locked for envelope ${input.envelopeId}`)
			}

			const actorRow = query(this.db, 'SELECT * FROM actors WHERE id = ?')
				.get(input.actorId) as ActorRow | undefined

			if (!actorRow) {
				throw new NotFoundError(`Actor ${input.actorId} not found`)
			}

			if (actorRow.version !== input.expectedActorVersion) {
				throw new ConcurrencyError(
					`Actor ${input.actorId} version mismatch: expected ${input.expectedActorVersion}, got ${actorRow.version}`
				)
			}

			query(
				this.db,
					`UPDATE actors
					 SET state_json = ?,
					     version = version + 1,
					     updated_at = ?
					 WHERE id = ?`
				)
				.run(stringifyJson(input.newActorState), nowIso, input.actorId)

			const insertEvent = query(
				this.db,
				`INSERT INTO actor_events (id, actor_id, envelope_id, event_type, event_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)

			for (const event of input.events) {
				const normalizedEvent = normalizeActorEventInput({
					event,
					actorId: input.actorId,
					envelopeId: input.envelopeId,
					now: input.now
				})

				insertEvent.run(
					normalizedEvent.id,
					normalizedEvent.actorId,
					normalizedEvent.envelopeId,
					normalizedEvent.eventType,
					stringifyJson(normalizedEvent.event),
					normalizedEvent.createdAt
				)
			}

			const previousActor = mapActorRow(actorRow)
			const inputEnvelope = mapEnvelopeRow(envelopeRow)
			const outgoingEnvelopes: EnvelopeRecord[] = []

			for (const outgoingEnvelope of input.outgoing) {
				outgoingEnvelopes.push(insertEnvelope(this.db, outgoingEnvelope, input.now))
			}

			query(
				this.db,
					`UPDATE envelopes
					 SET status = 'done',
					     locked_by = NULL,
					     locked_until = NULL,
					     updated_at = ?
					 WHERE id = ?`
				)
				.run(nowIso, input.envelopeId)

			query(this.db, 'DELETE FROM actor_locks WHERE actor_id = ? AND envelope_id = ?')
				.run(input.actorId, input.envelopeId)

			insertStreamEvents(
				this.db,
				buildCommitStreamEvents({
					actor: previousActor,
					newActorState: input.newActorState,
					inputEnvelope,
					actorEvents: input.events.map((event) =>
						normalizeActorEventInput({
							event,
							actorId: input.actorId,
							envelopeId: input.envelopeId,
							now: input.now
						})
					),
					outgoingEnvelopes,
					now: nowIso
				})
			)
		})
	}

	async failActivation(input: {
		workerId: string
		envelopeId: string
		error: string
		nonRetryable?: boolean
		retryAt?: Date
		now: Date
	}): Promise<void> {
		this.withTransaction(() => {
			const envelopeRow = query(this.db, 'SELECT * FROM envelopes WHERE id = ?')
				.get(input.envelopeId) as EnvelopeRow | undefined

			if (!envelopeRow) {
				throw new NotFoundError(`Envelope ${input.envelopeId} not found`)
			}

			if (envelopeRow.status !== 'processing') {
				throw new ConcurrencyError(`Envelope ${input.envelopeId} is not processing`)
			}

			if (envelopeRow.locked_by !== input.workerId) {
				throw new ConcurrencyError(`Envelope ${input.envelopeId} is not locked by ${input.workerId}`)
			}

			const nowIso = input.now.toISOString()
			const exhausted = input.nonRetryable === true || envelopeRow.attempts >= envelopeRow.max_attempts
			const nextAvailableAt = exhausted
				? envelopeRow.available_at
				: (input.retryAt ?? plusMilliseconds(input.now, exponentialBackoffMilliseconds(envelopeRow.attempts))).toISOString()
			const actorRow = exhausted
				? (query(this.db, 'SELECT * FROM actors WHERE id = ?').get(envelopeRow.to_actor) as ActorRow | undefined)
				: undefined
			const nextIntentState = exhausted ? buildFailedIntentState(actorRow, input.error) : null

			query(
				this.db,
					`UPDATE envelopes
					 SET status = ?,
					     available_at = ?,
					     locked_by = NULL,
					     locked_until = NULL,
					     last_error = ?,
					     updated_at = ?
					 WHERE id = ?`
				)
				.run(exhausted ? 'dead' : 'queued', nextAvailableAt, input.error, nowIso, input.envelopeId)

			query(this.db, 'DELETE FROM actor_locks WHERE actor_id = ? AND envelope_id = ?')
				.run(envelopeRow.to_actor, input.envelopeId)

			if (actorRow && nextIntentState) {
				query(
					this.db,
						`UPDATE actors
						 SET state_json = ?,
						     version = version + 1,
						     updated_at = ?
						 WHERE id = ?`
				)
					.run(stringifyJson(nextIntentState), nowIso, envelopeRow.to_actor)
			}

			insertStreamEvents(
				this.db,
				buildEnvelopeFailedStreamEvents({
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
					now: nowIso,
					nextIntentState
				})
			)
		})
	}

	async releaseExpiredLocks(now: Date): Promise<number> {
		return this.withTransaction(() => {
			const nowIso = now.toISOString()
			const staleEnvelopes = query(
				this.db,
					`SELECT * FROM envelopes
					 WHERE status = 'processing'
					   AND locked_until IS NOT NULL
					   AND locked_until < ?`
				)
				.all(nowIso) as EnvelopeRow[]

			const updateEnvelope = query(
				this.db,
				`UPDATE envelopes
				 SET status = ?,
				     available_at = ?,
				     locked_by = NULL,
				     locked_until = NULL,
				     updated_at = ?
				 WHERE id = ?`
			)
			const deleteLock = query(this.db, 'DELETE FROM actor_locks WHERE envelope_id = ?')

			for (const envelope of staleEnvelopes) {
				const exhausted = envelope.attempts >= envelope.max_attempts
				updateEnvelope.run(exhausted ? 'dead' : 'queued', nowIso, nowIso, envelope.id)
				deleteLock.run(envelope.id)
				insertStreamEvents(this.db, [{
					id: randomUUID(),
					scope: envelope.to_actor,
					actorId: envelope.to_actor,
					envelopeId: envelope.id,
					type: 'runtime.envelope.lease_expired',
					payload: {
						envelopeId: envelope.id,
						actorId: envelope.to_actor,
						lockedBy: envelope.locked_by,
						lockedUntil: envelope.locked_until,
						nextStatus: exhausted ? 'dead' : 'queued'
					},
					createdAt: nowIso
				}])
			}

			return staleEnvelopes.length
		})
	}

	async replaceSkills(skills: SkillRecordInput[], now: Date): Promise<void> {
		this.withTransaction(() => {
			query(this.db, 'DELETE FROM skills').run()
			const insertSkill = query(
				this.db,
				`INSERT INTO skills (id, path, frontmatter_json, body, body_hash, loaded_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)

			for (const skill of skills) {
				insertSkill.run(
					skill.id,
					skill.path,
					stringifyJson(skill.frontmatter),
					skill.body,
					skill.bodyHash,
					now.toISOString()
				)
			}
		})
	}

	async listSkills(): Promise<SkillRecord[]> {
		const rows = query(this.db, 'SELECT * FROM skills ORDER BY path ASC').all() as SkillRow[]
		return rows.map((row) => ({
			id: row.id,
			path: row.path,
			frontmatter: parseJson(row.frontmatter_json),
			body: row.body,
			bodyHash: row.body_hash,
			loadedAt: row.loaded_at
		}))
	}

	async listIntents(): Promise<Array<{ id: string; state: unknown; version: number; createdAt: string; updatedAt: string }>> {
		const rows = query(this.db, `SELECT * FROM actors WHERE kind = 'intent' ORDER BY created_at DESC`)
			.all() as ActorRow[]
		return rows.map((row) => ({
			id: extractIntentId(row.id),
			state: parseJson(row.state_json),
			version: row.version,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}))
	}

	async getIntent(intentId: string): Promise<{ id: string; state: unknown; version: number; createdAt: string; updatedAt: string } | null> {
		const row = query(this.db, `SELECT * FROM actors WHERE id = ? AND kind = 'intent'`).get(`intent/${intentId}`) as
			| ActorRow
			| undefined
		if (!row) {
			return null
		}
		return {
			id: intentId,
			state: parseJson(row.state_json),
			version: row.version,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	}

	async listStreamEvents(input: { scope: string; after?: number; limit?: number }): Promise<StreamEventRecord[]> {
		const rows = query(
			this.db,
				`SELECT * FROM stream_events
				 WHERE scope = ?
				   AND seq > ?
				 ORDER BY seq ASC
				 LIMIT ?`
			)
			.all(input.scope, input.after ?? 0, input.limit ?? 200) as StreamEventRow[]
		return rows.map(mapStreamEventRow)
	}

	private applyPragmas(): void {
		for (const pragma of SQLITE_PRAGMAS) {
			this.db.exec(pragma)
		}
	}

	private withTransaction<T>(callback: () => T): T {
		this.db.exec('BEGIN')
		try {
			const result = callback()
			this.db.exec('COMMIT')
			return result
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}

	private withImmediateTransaction<T>(callback: () => T): T {
		this.db.exec('BEGIN IMMEDIATE')
		try {
			const result = callback()
			this.db.exec('COMMIT')
			return result
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}
}

function inferActorKind(actorId: string): string {
	const [kind] = actorId.split('/', 1)
	return kind && kind.length > 0 ? kind : 'unknown'
}

function inferInitialActorState(input: {
	actorId: string
	envelopeType: string
	payload: unknown
}): unknown {
	if (input.actorId.startsWith('intent/') && input.envelopeType === 'intent.start') {
		const payload =
			input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
				? (input.payload as Record<string, unknown>)
				: null

		const intentId = typeof payload?.intentId === 'string' ? payload.intentId : extractIntentId(input.actorId)
		const title = typeof payload?.title === 'string' ? payload.title : ''
		const goal = typeof payload?.goal === 'string' ? payload.goal : ''

		if (intentId && title && goal) {
			return {
				intentId,
				title,
				goal,
				status: 'active',
				summary: goal,
				pendingSkillCalls: {}
			}
		}
	}

	return {}
}

function insertEnvelope(db: SqliteDatabase, envelope: EnvelopeInput, now = new Date()): EnvelopeRecord {
	const defaultTimestampIso = '1970-01-01T00:00:00.000Z'
	const createdAtIso = toIsoUtcString(envelope.createdAt, defaultTimestampIso)
	const availableAtIso = toIsoUtcString(envelope.availableAt, envelope.createdAt ?? defaultTimestampIso)

	query(
		db,
		`INSERT INTO envelopes (
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, NULL, NULL, NULL, ?, ?)`
	).run(
		envelope.id,
		envelope.fromActor,
		envelope.toActor,
		envelope.type,
		envelope.correlationId,
		envelope.causationId ?? null,
		stringifyJson(envelope.payload),
		availableAtIso,
		envelope.maxAttempts ?? 5,
		createdAtIso,
		createdAtIso
	)

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
	} satisfies EnvelopeRecord
}

function mapActorRow(row: ActorRow): ActorRecord {
	return {
		id: row.id,
		kind: row.kind,
		status: row.status,
		state: parseJson(row.state_json),
		version: row.version,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}
}

function mapEnvelopeRow(row: EnvelopeRow): EnvelopeRecord {
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
	}
}

function mapStreamEventRow(row: StreamEventRow): StreamEventRecord {
	return {
		seq: row.seq,
		id: row.id,
		scope: row.scope,
		actorId: row.actor_id,
		envelopeId: row.envelope_id,
		type: row.type,
		payload: parseJson(row.payload_json),
		createdAt: row.created_at
	}
}

function insertStreamEvents(
	db: SqliteDatabase,
	events: Array<{
		id: string
		scope: string
		actorId?: string | null
		envelopeId?: string | null
		type: string
		payload: unknown
		createdAt: string
	}>
): void {
	if (events.length === 0) {
		return
	}

	const insert = query(
		db,
		`INSERT OR IGNORE INTO stream_events (id, scope, actor_id, envelope_id, type, payload_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	)

	for (const event of events) {
		insert.run(
			event.id,
			event.scope,
			event.actorId ?? null,
			event.envelopeId ?? null,
			event.type,
			stringifyJson(event.payload),
			event.createdAt
		)
	}
}

function buildEnvelopeQueuedStreamEvents(input: { envelope: EnvelopeRecord; now: string }) {
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
	})
}

function buildEnvelopeClaimedStreamEvents(input: { envelope: EnvelopeRecord; workerId: string; now: string }) {
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
	})
}

function buildEnvelopeFailedStreamEvents(input: {
	envelope: EnvelopeRecord
	error: string
	now: string
	nextIntentState?: { intentId?: string; title?: string; summary?: string; status?: string } | null
}) {
	const events = [
		...scopedStreamEvents({
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
		})
	]

	if (input.envelope.status === 'dead' && input.nextIntentState?.intentId && input.nextIntentState.status === 'failed') {
		events.push(
			...scopedStreamEvents({
				baseId: `${input.envelope.id}:intent-status-failed`,
				actorId: input.envelope.toActor,
				envelopeId: input.envelope.id,
				type: 'intent.status_changed',
				payload: {
					intentId: input.nextIntentState.intentId,
					status: 'failed',
					summary: input.nextIntentState.summary,
					title: input.nextIntentState.title
				},
				createdAt: input.now,
				scopes: scopesForStreamEvent({
					actorId: input.envelope.toActor,
					correlationId: input.envelope.correlationId,
					intentId: input.nextIntentState.intentId
				})
			})
		)
	}

	return events
}

function buildCommitStreamEvents(input: {
	actor: ActorRecord
	newActorState: unknown
	inputEnvelope: EnvelopeRecord
	actorEvents: Required<Pick<ActorEventInput, 'id' | 'actorId' | 'eventType' | 'event' | 'createdAt'>>[] & Array<ActorEventInput>
	outgoingEnvelopes: EnvelopeRecord[]
	now: string
}) {
	const streamEvents: Array<{
		id: string
		scope: string
		actorId?: string | null
		envelopeId?: string | null
		type: string
		payload: unknown
		createdAt: string
	}> = []

	streamEvents.push(
		...scopedStreamEvents({
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
		})
	)

	for (const actorEvent of input.actorEvents) {
		streamEvents.push(
			...scopedStreamEvents({
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
			})
		)
	}

	for (const outgoing of input.outgoingEnvelopes) {
		streamEvents.push(...buildEnvelopeQueuedStreamEvents({ envelope: outgoing, now: input.now }))
	}

	const previousIntentState = input.actor.kind === 'intent' ? toIntentState(input.actor.state) : null
	const nextIntentState = input.actor.kind === 'intent' ? toIntentState(input.newActorState) : null
	const intentId = inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload)

	if (input.actor.kind === 'intent' && intentId && input.inputEnvelope.type === 'intent.start' && input.actor.version === 0) {
		streamEvents.push(
			...scopedStreamEvents({
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
			})
		)
	}

	if (
		input.actor.kind === 'intent' &&
		intentId &&
		nextIntentState &&
		(!previousIntentState ||
			previousIntentState.status !== nextIntentState.status ||
			previousIntentState.summary !== nextIntentState.summary)
	) {
		streamEvents.push(
			...scopedStreamEvents({
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
			})
		)
	}

	if (input.actor.kind === 'intent' && intentId) {
		for (const outgoing of input.outgoingEnvelopes) {
			if (outgoing.type === 'skill.request') {
				streamEvents.push(
					...scopedStreamEvents({
						baseId: `${outgoing.id}:skill-call-started`,
						actorId: input.actor.id,
						envelopeId: outgoing.id,
						type: 'intent.skill_call_started',
						payload: {
							intentId,
							callId: readString((outgoing.payload as Record<string, unknown>)?.callId),
							skillId: parseSkillId(outgoing.toActor),
							request: readString((outgoing.payload as Record<string, unknown>)?.request)
						},
						createdAt: input.now,
						scopes: scopesForStreamEvent({
							actorId: input.actor.id,
							correlationId: outgoing.correlationId,
							intentId: inferIntentId(input.actor.id, input.newActorState, outgoing.payload)
						})
					})
				)
			}

			if (outgoing.toActor === 'human' && (outgoing.type === 'human.message' || outgoing.type === 'human.question')) {
				streamEvents.push(
					...scopedStreamEvents({
						baseId: `${outgoing.id}:message-to-user`,
						actorId: input.actor.id,
						envelopeId: outgoing.id,
						type: 'intent.message_to_user',
						payload: {
							intentId,
							messageType: outgoing.type,
							...(typeof outgoing.payload === 'object' && outgoing.payload ? (outgoing.payload as Record<string, unknown>) : {})
						},
						createdAt: input.now,
						scopes: scopesForStreamEvent({
							actorId: input.actor.id,
							correlationId: outgoing.correlationId,
							intentId: inferIntentId(input.actor.id, input.newActorState, outgoing.payload)
						})
					})
				)
			}
		}

		if (
			input.inputEnvelope.type === 'skill.result' ||
			input.inputEnvelope.type === 'skill.failed' ||
			input.inputEnvelope.type === 'skill.needs_clarification'
		) {
			const payload = typeof input.inputEnvelope.payload === 'object' && input.inputEnvelope.payload ? input.inputEnvelope.payload : {}
			streamEvents.push(
				...scopedStreamEvents({
					baseId: `${input.inputEnvelope.id}:skill-call-completed`,
					actorId: input.actor.id,
					envelopeId: input.inputEnvelope.id,
					type: 'intent.skill_call_completed',
					payload: {
						intentId,
						messageType: input.inputEnvelope.type,
						...(payload as Record<string, unknown>)
					},
					createdAt: input.now,
					scopes: scopesForStreamEvent({ actorId: input.actor.id, correlationId: input.inputEnvelope.correlationId, intentId })
				})
			)
		}
	}

		const supervisorIntentId = inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload)

	if (input.actor.kind === 'skill-supervisor') {
		for (const outgoing of input.outgoingEnvelopes) {
			if (outgoing.toActor.startsWith('skill-worker/')) {
				const type = hasInitialState(outgoing.payload) ? 'skill.worker_spawned' : 'skill.worker_routed'
				streamEvents.push(
					...scopedStreamEvents({
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
					})
				)
			}
		}

		if (input.inputEnvelope.type === 'skill.worker.result') {
			streamEvents.push(
				...scopedStreamEvents({
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
				})
			)
		}
	}

	return streamEvents
}

function scopedStreamEvents(input: {
	baseId: string
	scopes: string[]
	actorId?: string | null
	envelopeId?: string | null
	type: string
	payload: unknown
	createdAt: string
}) {
	return [...new Set(input.scopes)].map((scope) => ({
		id: `${input.baseId}:${scope}`,
		scope,
		actorId: input.actorId ?? null,
		envelopeId: input.envelopeId ?? null,
		type: input.type,
		payload: input.payload,
		createdAt: input.createdAt
	}))
}

function scopesForEnvelope(envelope: EnvelopeRecord): string[] {
	return scopesForStreamEvent({
		actorId: envelope.toActor,
		correlationId: envelope.correlationId,
		intentId: inferIntentId(envelope.toActor, envelope.payload, envelope.payload)
	})
}

function scopesForStreamEvent(input: {
	actorId?: string | null
	correlationId?: string | null
	intentId?: string | null
}): string[] {
	return [
		'global',
		input.actorId ? `actor/${input.actorId}` : null,
		input.correlationId ? `correlation/${input.correlationId}` : null,
		input.intentId ? `intent/${input.intentId}` : null
	].filter(
		(value): value is string => Boolean(value)
	)
}

function inferIntentId(actorId: string | null | undefined, state: unknown, payload: unknown): string | null {
	if (actorId?.startsWith('intent/')) {
		return extractIntentId(actorId)
	}

	const candidate =
		readIntentIdFromUnknown(payload) ??
		readIntentIdFromUnknown(state)

	if (candidate) {
		return candidate
	}

	return null
}

function normalizeActorEventInput(input: {
	event: ActorEventInput
	actorId: string
	envelopeId: string
	now: Date
}): Required<Pick<ActorEventInput, 'id' | 'actorId' | 'eventType' | 'event' | 'createdAt'>> & ActorEventInput {
	return {
		...input.event,
		id: input.event.id ?? randomUUID(),
		actorId: input.event.actorId ?? input.actorId,
		envelopeId: input.event.envelopeId ?? input.envelopeId,
		createdAt: toIsoUtcString(input.event.createdAt, input.now)
	}
}

function readIntentIdFromUnknown(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const record = value as Record<string, unknown>
	if (typeof record.intentId === 'string' && record.intentId.length > 0) {
		return record.intentId
	}

	for (const key of ['result', 'input', 'call'] as const) {
		const nested = readIntentIdFromUnknown(record[key])
		if (nested) {
			return nested
		}
	}

	return null
}

function extractIntentId(actorId: string): string {
	return actorId.startsWith('intent/') ? actorId.slice('intent/'.length) : actorId
}

function parseSkillId(actorId: string | null | undefined): string | null {
	if (!actorId?.startsWith('skill/')) {
		return null
	}
	return actorId.slice('skill/'.length) || null
}

function parseWorkerId(actorId: string): string | null {
	if (!actorId.startsWith('skill-worker/')) {
		return null
	}
	const parts = actorId.split('/')
	return parts[2] ?? null
}

function hasInitialState(payload: unknown): boolean {
	return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && 'initialState' in payload)
}

function toIntentState(state: unknown): null | {
	intentId?: string
	title?: string
	goal?: string
	status?: string
	summary?: string
} {
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		return null
	}
	return state as {
		intentId?: string
		title?: string
		goal?: string
		status?: string
		summary?: string
	}
}

function buildFailedIntentState(actorRow: ActorRow | undefined, error: string): {
	intentId?: string
	title?: string
	goal?: string
	status: 'failed'
	summary: string
	pendingSkillCalls?: Record<string, unknown>
} | null {
	if (!actorRow || actorRow.kind !== 'intent') {
		return null
	}

	const state = toIntentState(parseJson(actorRow.state_json))
	if (!state?.intentId) {
		return null
	}

	return {
		...state,
		status: 'failed',
		summary: error,
		pendingSkillCalls: {}
	}
}

function readString(value: unknown): string | null {
	return typeof value === 'string' ? value : null
}

function query(db: SqliteDatabase, sql: string): SqliteStatement {
	return db.query(sql)
}