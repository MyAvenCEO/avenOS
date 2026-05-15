import { randomUUID } from 'node:crypto'

import { Database } from 'bun:sqlite'

import {
	HUMAN_ACTOR_ID,
	INTENTS_ACTOR_ID,
	SKILLS_ACTOR_ID,
	assertCanonicalActorId,
	actorKindFromId,
	createIntentActorId,
	parseActorId,
	parseIntentActorId,
	parseSkillActorId,
	parseSkillWorkerActorId
} from './actor-id'
import { exponentialBackoffMilliseconds, plusMilliseconds, toIsoUtcString } from './clock'
import { ConcurrencyError, NotFoundError } from './errors'
import { parseJson, stringifyJson } from './json'
import { SQLITE_PRAGMAS, SQLITE_SCHEMA } from './schema'
import type {
	ActorCommand,
	ActorEventInput,
	ActorHierarchyRecord,
	ActorLogRecord,
	ActorRecord,
	ClaimedEnvelope,
	ContextAppendInput,
	ContextItemRecord,
	ContextQuery,
	ContextVisibility,
	CommunicationTreeRecord,
	CommunicationTreeSummary,
	EnvelopeInput,
	EnvelopeRecord,
	Persistence,
	SkillRecord,
	SkillRecordInput,
	EventInput,
	EventRecord
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
	run_id: string
	caused_by: string | null
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

type EventRow = {
	seq: number
	visibility: 'chat' | 'worklog' | 'debug'
	run_id: string | null
	intent_id: string | null
	actor_id: string | null
	envelope_id: string | null
	call_id: string | null
	parent_seq: number | null
	type: string
	payload_json: string
	created_at: string
}

type ContextItemRow = {
	seq: number
	kind: string
	visibility: ContextVisibility
	run_id: string | null
	intent_id: string | null
	actor_id: string | null
	envelope_id: string | null
	call_id: string | null
	key: string | null
	body_json: string | null
	artifact_uri: string | null
	summary: string | null
	created_at: string
}

export interface SqlitePersistenceOptions {
	filename?: string
	database?: SqliteDatabase
}

type SqliteDatabase = {
	exec(sql: string): unknown
	query(sql: string): ReturnType<Database['query']>
	prepare(sql: string): ReturnType<Database['query']>
}

type SqliteStatement = ReturnType<Database['query']>

type RunResult = {
	changes: number
	lastInsertRowid: number | bigint
}

export class SqlitePersistence implements Persistence {
	readonly db: SqliteDatabase

	constructor(options: SqlitePersistenceOptions = {}) {
		this.db = options.database ?? (new Database(options.filename ?? ':memory:') as unknown as SqliteDatabase)
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
		assertActorRecordIdentity(input.id, input.kind)
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
		assertActorRecordIdentity(input.id, input.kind)
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
		assertCanonicalActorId(envelope.fromActor)
		assertCanonicalActorId(envelope.toActor)
		this.withTransaction(() => {
			const insertedEnvelope = insertEnvelope(this.db, envelope)
			insertEvents(this.db, buildEnvelopeQueuedEvents({ envelope: insertedEnvelope, now: insertedEnvelope.createdAt }))
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

			insertEvents(this.db, buildEnvelopeClaimedEvents({
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
		nextActorState: unknown
		contextAppends: ContextAppendInput[]
		commands: ActorCommand[]
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
				.run(stringifyJson(input.nextActorState), nowIso, input.actorId)

			const inputEnvelope = mapEnvelopeRow(envelopeRow)
			const previousActor = mapActorRow(actorRow)
			const persistedContextRecords = appendContext(this.db, {
				appends: input.contextAppends,
				actorId: input.actorId,
				envelope: inputEnvelope,
				now: input.now
			})

			const normalizedActorEvents: Array<Required<Pick<ActorEventInput, 'id' | 'actorId' | 'eventType' | 'event' | 'createdAt'>> & ActorEventInput> = []
			const outgoingEnvelopes: EnvelopeRecord[] = []

			for (const command of input.commands) {
				if (command.type === 'emit_event') {
					const normalizedEvent = normalizeActorEventInput({
						event: command.event,
						actorId: input.actorId,
						envelopeId: input.envelopeId,
						now: input.now
					})
					normalizedActorEvents.push(normalizedEvent)
					continue
				}

				if (command.type === 'send_envelope') {
					outgoingEnvelopes.push(insertEnvelope(this.db, command.envelope, input.now))
					continue
				}

				outgoingEnvelopes.push(
					insertEnvelope(
						this.db,
						{
							...command.envelope,
							availableAt: command.availableAt
						},
						input.now
					)
				)
			}

			query(
				this.db,
					`UPDATE envelopes
					 SET status = 'done',
					     last_error = NULL,
					     locked_by = NULL,
					     locked_until = NULL,
					     updated_at = ?
					 WHERE id = ?`
				)
				.run(nowIso, input.envelopeId)

			query(this.db, 'DELETE FROM actor_locks WHERE actor_id = ? AND envelope_id = ?')
				.run(input.actorId, input.envelopeId)

			insertEvents(
				this.db,
				buildCommitEvents({
					actor: previousActor,
					newActorState: input.nextActorState,
					inputEnvelope,
					actorEvents: normalizedActorEvents,
					outgoingEnvelopes,
					contextItems: persistedContextRecords,
					now: nowIso
				})
			)
		})
	}

	async appendContext(input: ContextAppendInput): Promise<number> {
		const now = input.createdAt instanceof Date || typeof input.createdAt === 'string'
			? new Date(input.createdAt)
			: new Date()
		const item = materializeContextItemRecord({
			append: input,
			actorId: input.actorId ?? null,
			envelopeId: input.envelopeId ?? null,
			runId: input.runId ?? null,
			now
		})
		return insertContextItem(this.db, item)
	}

	async listContextItems(input: {
		selector: ContextQuery
		snapshotSeq?: number
	}): Promise<ContextItemRecord[]> {
		const clauses: string[] = []
		const params: Array<string | number> = []

		if (input.snapshotSeq !== undefined) {
			clauses.push('seq <= ?')
			params.push(input.snapshotSeq)
		}
		if (input.selector.afterSeq !== undefined) {
			clauses.push('seq > ?')
			params.push(input.selector.afterSeq)
		}
		if (input.selector.runId) {
			clauses.push('run_id = ?')
			params.push(input.selector.runId)
		}
		if (input.selector.intentId) {
			clauses.push('intent_id = ?')
			params.push(input.selector.intentId)
		}
		if (input.selector.callId) {
			clauses.push('call_id = ?')
			params.push(input.selector.callId)
		}
		if (input.selector.actorId) {
			clauses.push('actor_id = ?')
			params.push(input.selector.actorId)
		}
		if (input.selector.visibility) {
			const visibilityValues = Array.isArray(input.selector.visibility)
				? input.selector.visibility
				: [input.selector.visibility]
			clauses.push(`visibility IN (${visibilityValues.map(() => '?').join(', ')})`)
			params.push(...visibilityValues)
		}
		if (input.selector.kind) {
			const kindValues = Array.isArray(input.selector.kind) ? input.selector.kind : [input.selector.kind]
			clauses.push(`kind IN (${kindValues.map(() => '?').join(', ')})`)
			params.push(...kindValues)
		}

		const rows = query(
			this.db,
			`SELECT * FROM context_items ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY seq ASC LIMIT ?`
		).all(...params, input.selector.limit ?? 200) as ContextItemRow[]

		return rows.map(mapContextItemRow)
	}

	async getContextSnapshotSeq(): Promise<number> {
		const row = query(this.db, 'SELECT COALESCE(MAX(seq), 0) AS seq FROM context_items').get() as { seq: number }
		return row.seq ?? 0
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

			insertEvents(
				this.db,
				buildEnvelopeFailedEvents({
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
				insertEvents(this.db, [{
					type: 'runtime.envelope.lease_expired',
					visibility: eventVisibilityForType('runtime.envelope.lease_expired'),
					runId: envelope.run_id,
					actorId: envelope.to_actor,
					envelopeId: envelope.id,
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

	async appendEvents(events: EventInput[]): Promise<number[]> {
		return this.withTransaction(() => {
			return insertEvents(this.db, events.map((event) => ({
				type: event.type,
				visibility: event.visibility,
				runId: event.runId ?? null,
				intentId: event.intentId ?? null,
				actorId: event.actorId ?? null,
				envelopeId: event.envelopeId ?? null,
				callId: event.callId ?? null,
				parentSeq: event.parentSeq ?? null,
				payload: event.payload,
				createdAt: toIsoUtcString(event.createdAt, new Date())
			})))
		})
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
		const row = query(this.db, `SELECT * FROM actors WHERE id = ? AND kind = 'intent'`).get(createIntentActorId(intentId)) as
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

	async listEvents(input: {
		after?: number
		limit?: number
		visibility?: 'chat' | 'worklog' | 'debug' | Array<'chat' | 'worklog' | 'debug'>
		runId?: string
		intentId?: string
		actorId?: string
		callId?: string
	}): Promise<EventRecord[]> {
		const clauses = ['seq > ?']
		const params: Array<string | number> = [input.after ?? 0]

		if (input.visibility) {
			const visibilityValues = Array.isArray(input.visibility) ? input.visibility : [input.visibility]
			clauses.push(`visibility IN (${visibilityValues.map(() => '?').join(', ')})`)
			params.push(...visibilityValues)
		}
		if (input.runId) {
			clauses.push('run_id = ?')
			params.push(input.runId)
		}
		if (input.intentId) {
			clauses.push('intent_id = ?')
			params.push(input.intentId)
		}
		if (input.actorId) {
			clauses.push('actor_id = ?')
			params.push(input.actorId)
		}
		if (input.callId) {
			clauses.push('call_id = ?')
			params.push(input.callId)
		}

		const rows = query(
			this.db,
				`SELECT * FROM events
				 WHERE ${clauses.join(' AND ')}
				 ORDER BY seq ASC
				 LIMIT ?`
			)
			.all(...params, input.limit ?? 200) as EventRow[]
		return rows.map(mapEventRow)
	}

	async listActorHierarchy(input: { rootActorId: string; observed?: boolean; includeRoot?: boolean }): Promise<ActorHierarchyRecord[]> {
		const root = assertCanonicalActorId(input.rootActorId)
		const prefix = `${input.rootActorId}/%`
		const rows = input.observed
			? (query(
					this.db,
					`WITH observed AS (
					   SELECT actor_id AS actor_id, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
					   FROM events
					   WHERE actor_id IS NOT NULL AND (actor_id = ? OR actor_id LIKE ?)
					   GROUP BY actor_id
					 )
					 SELECT o.actor_id,
					        a.kind,
					        a.created_at,
					        a.updated_at
					 FROM observed o
					 LEFT JOIN actors a ON a.id = o.actor_id
					 ORDER BY o.actor_id ASC`
				)
				.all(input.rootActorId, prefix) as Array<{ actor_id: string; kind: string | null; created_at: string | null; updated_at: string | null }>)
			: (query(
					this.db,
					`SELECT id AS actor_id, kind, created_at, updated_at
					 FROM actors
					 WHERE id = ? OR id LIKE ?
					 ORDER BY id ASC`
				)
				.all(input.rootActorId, prefix) as Array<{ actor_id: string; kind: string | null; created_at: string | null; updated_at: string | null }>)

		return rows
			.filter((row) => (input.includeRoot ?? false) || row.actor_id !== input.rootActorId)
			.map((row) => mapActorHierarchyRecord(row.actor_id, row.kind, row.created_at, row.updated_at, input.observed === true, root))
	}

	async listActorBranchLogs(input: {
		rootActorId: string
		view?: 'chat' | 'deep-dive'
		after?: number
		limit?: number
	}): Promise<ActorLogRecord[]> {
		assertCanonicalActorId(input.rootActorId)
		const view = input.view ?? 'deep-dive'
		const prefix = `actor/${input.rootActorId}/%`
		const actorPrefix = `${input.rootActorId}/%`
		const rows = query(
			this.db,
				`SELECT * FROM events
				 WHERE seq > ?
				   AND actor_id IS NOT NULL
				   AND (actor_id = ? OR actor_id LIKE ?)
				   ${visibilityWhereClause(view)}
				 ORDER BY seq ASC
				 LIMIT ?`
		)
			.all(input.after ?? 0, input.rootActorId, actorPrefix, input.limit ?? 200) as EventRow[]
		return rows.map((row) => ({ ...mapEventRow(row), logView: view }))
	}

	async listCommunicationTree(input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeRecord[]> {
		const selector = resolveCommunicationSelector(input)
		const rows = query(
			this.db,
				`WITH RECURSIVE roots AS (
				   SELECT e.id, e.caused_by, e.run_id, e.from_actor, e.to_actor, e.type, e.payload_json, e.created_at
				   FROM envelopes e
				   WHERE ${selector.rootWhere}
				 ), tree AS (
				   SELECT r.id, r.caused_by, r.run_id, r.from_actor, r.to_actor, r.type, r.payload_json, r.created_at, 0 AS depth
				   FROM roots r
				   UNION ALL
				   SELECT e.id, e.caused_by, e.run_id, e.from_actor, e.to_actor, e.type, e.payload_json, e.created_at, t.depth + 1
				   FROM envelopes e
				   JOIN tree t ON e.caused_by = t.id
				 )
				 SELECT 'env:' || t.id AS node_id,
				        CASE WHEN t.caused_by IS NULL THEN NULL ELSE 'env:' || t.caused_by END AS parent_node_id,
				        'envelope' AS node_kind,
				        t.depth,
				        t.run_id,
				        t.id AS envelope_id,
				        t.to_actor AS actor_id,
				        t.from_actor,
				        t.to_actor,
				        t.type AS event_type,
				        t.payload_json,
				        t.created_at
				 FROM tree t
				 UNION ALL
				 SELECT 'log:' || s.seq AS node_id,
				        CASE WHEN s.envelope_id IS NULL THEN NULL ELSE 'env:' || s.envelope_id END AS parent_node_id,
				        'log' AS node_kind,
				        tree.depth + 1 AS depth,
				        s.run_id,
				        s.envelope_id,
				        s.actor_id,
				        json_extract(s.payload_json, '$.fromActor') AS from_actor,
				        json_extract(s.payload_json, '$.toActor') AS to_actor,
				        s.type AS event_type,
				        s.payload_json,
				        s.created_at
				 FROM events s
				 JOIN tree ON s.envelope_id = tree.id
				 WHERE 1=1 ${visibilityWhereClause(input.view ?? 'deep-dive', 's')}
				 ORDER BY created_at ASC, node_id ASC`
		)
			.all(...selector.params) as Array<{
				node_id: string
				parent_node_id: string | null
				node_kind: 'envelope' | 'log'
				depth: number
				run_id: string | null
				envelope_id: string | null
				actor_id: string | null
				from_actor: string | null
				to_actor: string | null
				event_type: string
				payload_json: string
				created_at: string
			}>
		return rows.map((row) => ({
			nodeId: row.node_id,
			parentNodeId: row.parent_node_id,
			nodeKind: row.node_kind,
			depth: row.depth,
			runId: row.run_id,
			envelopeId: row.envelope_id,
			actorId: row.actor_id,
			fromActor: row.from_actor,
			toActor: row.to_actor,
			eventType: row.event_type,
			payload: parseJson(row.payload_json),
			createdAt: row.created_at
		}))
	}

	async summarizeCommunicationTree(input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeSummary> {
		const rows = await this.listCommunicationTree(input)
		const actors = new Set(rows.map((row) => row.actorId).filter((value): value is string => Boolean(value)))
		return {
			rootCount: rows.filter((row) => row.parentNodeId === null).length,
			envelopeCount: rows.filter((row) => row.nodeKind === 'envelope').length,
			logCount: rows.filter((row) => row.nodeKind === 'log').length,
			actorCount: actors.size,
			actorIoCount: rows.filter((row) => row.eventType.startsWith('actor.io.')).length,
			errorCount: rows.filter((row) => row.eventType.includes('failed') || row.eventType.includes('error')).length,
			startedAt: rows[0]?.createdAt ?? null,
			endedAt: rows.at(-1)?.createdAt ?? null
		}
	}

	async listStructuralActorChildren(input: { parentActorId?: string | null }): Promise<Array<ActorHierarchyRecord & { directChildCount: number }>> {
		const rows = query(
			this.db,
				`WITH known AS (
				   SELECT actor_id, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
				   FROM events
				   WHERE actor_id IS NOT NULL
				   GROUP BY actor_id
				   UNION
				   SELECT id AS actor_id, created_at AS first_seen_at, updated_at AS last_seen_at
				   FROM actors
				 )
				 SELECT k.actor_id,
				        a.kind,
				        MIN(k.first_seen_at) AS first_seen_at,
				        MAX(k.last_seen_at) AS last_seen_at
				 FROM known k
				 LEFT JOIN actors a ON a.id = k.actor_id
				 GROUP BY k.actor_id, a.kind
				 ORDER BY k.actor_id ASC`
		).all() as Array<{
			actor_id: string
			kind: string | null
			first_seen_at: string | null
			last_seen_at: string | null
		}>

		const parentActorId = input.parentActorId ?? null
		const allActors = rows
			.map((row) => {
				const parsed = parseActorId(row.actor_id)
				return {
					actorId: row.actor_id,
					parentActorId: parsed.parentId ?? null,
					kind: row.kind ?? parsed.kind,
					name: parsed.name,
					depth: Math.max(0, parsed.segments.length - 1),
					isCurrent: row.kind !== null,
					firstSeenAt: row.first_seen_at,
					lastSeenAt: row.last_seen_at
				}
			})
			.filter((row): row is ActorHierarchyRecord => Boolean(row))

		const actorMap = new Map<string, ActorHierarchyRecord>()
		for (const actor of allActors) {
			actorMap.set(actor.actorId, actor)
			let parentId = actor.parentActorId
			while (parentId) {
				if (actorMap.has(parentId)) {
					parentId = actorMap.get(parentId)?.parentActorId ?? null
					continue
				}
				const parsedParent = parseActorId(parentId)
				actorMap.set(parentId, {
					actorId: parsedParent.id,
					parentActorId: parsedParent.parentId,
					kind: parsedParent.kind,
					name: parsedParent.name,
					depth: Math.max(0, parsedParent.segments.length - 1),
					isCurrent: false,
					firstSeenAt: null,
					lastSeenAt: null
				})
				parentId = parsedParent.parentId
			}
		}

		for (const virtualRootId of ['aven', 'aven/system', 'aven/intents', 'aven/skills'] as const) {
			if (actorMap.has(virtualRootId)) continue
			const parsed = parseActorId(virtualRootId)
			actorMap.set(virtualRootId, {
				actorId: parsed.id,
				parentActorId: parsed.parentId,
				kind: parsed.kind,
				name: parsed.name,
				depth: Math.max(0, parsed.segments.length - 1),
				isCurrent: false,
				firstSeenAt: null,
				lastSeenAt: null
			})
		}

		const allActorNodes = [...actorMap.values()].sort((a, b) => a.actorId.localeCompare(b.actorId))

		const childCounts = new Map<string, number>()
		for (const actor of allActorNodes) {
			if (!actor.parentActorId) continue
			childCounts.set(actor.parentActorId, (childCounts.get(actor.parentActorId) ?? 0) + 1)
		}

		return allActorNodes
			.filter((actor) => actor.parentActorId === parentActorId)
			.map((actor) => ({
				...actor,
				directChildCount: childCounts.get(actor.actorId) ?? 0
			}))
	}

	async listCommunicationActorChildren(input: { actorId?: string | null }): Promise<Array<ActorHierarchyRecord & { directChildCount: number; messageCount: number }>> {
		const rows = input.actorId
			? (query(
					this.db,
					`SELECT e.to_actor AS actor_id,
					        COUNT(*) AS message_count,
					        MIN(e.created_at) AS first_seen_at,
					        MAX(e.created_at) AS last_seen_at,
					        a.kind AS kind
					 FROM envelopes e
					 LEFT JOIN actors a ON a.id = e.to_actor
					 WHERE e.from_actor = ?
					 GROUP BY e.to_actor, a.kind
					 ORDER BY e.to_actor ASC`
				)
				.all(input.actorId) as Array<{
					actor_id: string
					message_count: number
					first_seen_at: string | null
					last_seen_at: string | null
					kind: string | null
				}>)
			: (query(
					this.db,
					`SELECT e.from_actor AS actor_id,
					        COUNT(*) AS message_count,
					        MIN(e.created_at) AS first_seen_at,
					        MAX(e.created_at) AS last_seen_at,
					        a.kind AS kind
					 FROM envelopes e
					 LEFT JOIN actors a ON a.id = e.from_actor
					 GROUP BY e.from_actor, a.kind
					 ORDER BY e.from_actor ASC`
				)
				.all() as Array<{
					actor_id: string
					message_count: number
					first_seen_at: string | null
					last_seen_at: string | null
					kind: string | null
				}>)

		const childCountRows = query(
			this.db,
				`SELECT from_actor AS actor_id, COUNT(DISTINCT to_actor) AS direct_child_count
				 FROM envelopes
				 GROUP BY from_actor`
		).all() as Array<{ actor_id: string; direct_child_count: number }>

		const childCounts = new Map(childCountRows.map((row) => [row.actor_id, row.direct_child_count]))

		return rows
			.map((row) => {
				const parsed = parseActorId(row.actor_id)
				if (!parsed) {
					return null
				}
				return {
					actorId: row.actor_id,
					parentActorId: input.actorId ?? null,
					kind: row.kind ?? parsed.kind,
					name: parsed.name,
					depth: input.actorId ? 1 : 0,
					isCurrent: true,
					firstSeenAt: row.first_seen_at,
					lastSeenAt: row.last_seen_at,
					directChildCount: childCounts.get(row.actor_id) ?? 0,
					messageCount: row.message_count
				}
			})
			.filter((row): row is ActorHierarchyRecord & { directChildCount: number; messageCount: number } => Boolean(row))
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
	const parsed = assertCanonicalActorId(actorId)
	switch (parsed.kind) {
		case 'worker':
			return 'skill-worker'
		case 'skill':
			return 'skill-supervisor'
		case 'system':
			return actorId === HUMAN_ACTOR_ID ? 'human-outbox' : 'dispatcher'
		case 'group':
			return actorId === INTENTS_ACTOR_ID ? 'group' : actorId === SKILLS_ACTOR_ID ? 'group' : 'group'
		case 'intent':
			return 'intent'
		case 'runtime':
			return 'runtime'
		default:
			return actorKindFromId(actorId)
	}
}

function assertActorRecordIdentity(actorId: string, kind: string): void {
	const parsed = assertCanonicalActorId(actorId)
	if (!actorKindMatches(parsed.kind, kind, actorId)) {
		throw new Error(`Actor kind mismatch for ${actorId}: expected ${parsed.kind}, got ${kind}`)
	}
}

function actorKindMatches(parsedKind: string, recordKind: string, actorId: string): boolean {
	if (parsedKind === recordKind) {
		return true
	}

	switch (parsedKind) {
		case 'system':
			return recordKind === 'dispatcher' || recordKind === 'human-outbox'
		case 'group':
			return recordKind === 'group' || (actorId === INTENTS_ACTOR_ID && recordKind === 'intents') || (actorId === SKILLS_ACTOR_ID && recordKind === 'skills')
		case 'skill':
			return recordKind === 'skill-supervisor'
		case 'worker':
			return recordKind === 'skill-worker' || recordKind === 'worker'
		default:
			return false
	}
}

function inferInitialActorState(input: {
	actorId: string
	envelopeType: string
	payload: unknown
}): unknown {
	if (parseIntentActorId(input.actorId) && input.envelopeType === 'intent.start') {
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
		  run_id,
		  caused_by,
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
		envelope.runId,
		envelope.causedBy ?? null,
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
		runId: envelope.runId,
		causedBy: envelope.causedBy ?? null,
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
		runId: row.run_id,
		causedBy: row.caused_by,
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

function mapEventRow(row: EventRow): EventRecord {
	return {
		seq: row.seq,
		visibility: row.visibility,
		runId: row.run_id,
		intentId: row.intent_id,
		actorId: row.actor_id,
		envelopeId: row.envelope_id,
		callId: row.call_id,
		parentSeq: row.parent_seq,
		type: row.type,
		payload: parseJson(row.payload_json),
		createdAt: row.created_at
	}
}

function mapContextItemRow(row: ContextItemRow): ContextItemRecord {
	return {
		seq: row.seq,
		kind: row.kind,
		visibility: row.visibility,
		runId: row.run_id,
		intentId: row.intent_id,
		actorId: row.actor_id,
		envelopeId: row.envelope_id,
		callId: row.call_id,
		key: row.key,
		summary: row.summary,
		body: row.body_json ? parseJson(row.body_json) : undefined,
		artifactUri: row.artifact_uri,
		createdAt: row.created_at
	}
}


function insertContextItem(db: SqliteDatabase, item: Omit<ContextItemRecord, 'seq'>): number {
	const result = query(
		db,
		`INSERT INTO context_items (
		  kind,
		  visibility,
		  run_id,
		  intent_id,
		  actor_id,
		  envelope_id,
		  call_id,
		  key,
		  summary,
		  body_json,
		  artifact_uri,
		  created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		item.kind,
		item.visibility,
		item.runId,
		item.intentId,
		item.actorId,
		item.envelopeId,
		item.callId,
		item.key,
		item.summary,
		item.body === undefined ? null : stringifyJson(item.body),
		item.artifactUri,
		item.createdAt
	)
	return Number(result.lastInsertRowid)
}

function appendContext(db: SqliteDatabase, input: {
	appends: ContextAppendInput[]
	actorId: string
	envelope: EnvelopeRecord
	now: Date
}): ContextItemRecord[] {
	const persisted: ContextItemRecord[] = []
	for (const append of input.appends) {
		const item = materializeContextItemRecord({
			append,
			actorId: input.actorId,
			envelopeId: input.envelope.id,
			runId: input.envelope.runId,
			now: append.createdAt instanceof Date || typeof append.createdAt === 'string' ? new Date(append.createdAt) : input.now
		})
		const seq = insertContextItem(db, item)
		persisted.push({ ...item, seq })
	}
	return persisted
}

function materializeContextItemRecord(input: {
	append: ContextAppendInput
	actorId: string | null
	envelopeId: string | null
	runId: string | null
	now: Date
}): Omit<ContextItemRecord, 'seq'> {
	return {
		kind: input.append.kind,
		visibility: input.append.visibility ?? 'worklog',
		runId: input.append.runId ?? input.runId ?? null,
		intentId: input.append.intentId ?? null,
		actorId: input.append.actorId ?? input.actorId ?? null,
		envelopeId: input.append.envelopeId ?? input.envelopeId ?? null,
		callId: input.append.callId ?? null,
		key: input.append.key ?? null,
		summary: input.append.summary ?? null,
		body: input.append.body,
		artifactUri: input.append.artifactUri ?? null,
		createdAt: toIsoUtcString(input.append.createdAt, input.now)
	}
}

function insertEvents(
	db: SqliteDatabase,
	events: EventInput[]
): number[] {
	if (events.length === 0) {
		return []
	}

	const insert = query(
		db,
		`INSERT INTO events (type, visibility, run_id, intent_id, actor_id, envelope_id, call_id, parent_seq, payload_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)
	const seqs: number[] = []

	for (const event of events) {
		const result = insert.run(
			event.type,
			event.visibility,
			event.runId ?? null,
			event.intentId ?? null,
			event.actorId ?? null,
			event.envelopeId ?? null,
			event.callId ?? null,
			event.parentSeq ?? null,
			stringifyJson(event.payload),
			toIsoUtcString(event.createdAt, new Date())
		)
		seqs.push(Number(result.lastInsertRowid))
	}
	return seqs
}

function buildEnvelopeQueuedEvents(input: { envelope: EnvelopeRecord; now: string }): EventInput[] {
	return [{
		type: 'runtime.envelope.queued',
		visibility: eventVisibilityForType('runtime.envelope.queued'),
		runId: input.envelope.runId,
		intentId: inferIntentId(input.envelope.toActor, undefined, input.envelope.payload),
		actorId: input.envelope.toActor,
		envelopeId: input.envelope.id,
		callId: inferCallId(input.envelope.payload),
		payload: {
			envelopeId: input.envelope.id,
			fromActor: input.envelope.fromActor,
			toActor: input.envelope.toActor,
			envelopeType: input.envelope.type,
			runId: input.envelope.runId
		},
		createdAt: input.now
	}]
}

function buildEnvelopeClaimedEvents(input: { envelope: EnvelopeRecord; workerId: string; now: string }): EventInput[] {
	return [{
		type: 'runtime.envelope.claimed',
		visibility: eventVisibilityForType('runtime.envelope.claimed'),
		runId: input.envelope.runId,
		intentId: inferIntentId(input.envelope.toActor, undefined, input.envelope.payload),
		actorId: input.envelope.toActor,
		envelopeId: input.envelope.id,
		callId: inferCallId(input.envelope.payload),
		payload: {
			envelopeId: input.envelope.id,
			actorId: input.envelope.toActor,
			workerId: input.workerId,
			attempts: input.envelope.attempts
		},
		createdAt: input.now
	}]
}

function buildEnvelopeFailedEvents(input: {
	envelope: EnvelopeRecord
	error: string
	now: string
	nextIntentState?: { intentId?: string; title?: string; summary?: string; status?: string } | null
}): EventInput[] {
	const events: EventInput[] = [{
		type: 'runtime.envelope.failed',
		visibility: eventVisibilityForType('runtime.envelope.failed'),
		runId: input.envelope.runId,
		intentId: inferIntentId(input.envelope.toActor, input.nextIntentState, input.envelope.payload),
		actorId: input.envelope.toActor,
		envelopeId: input.envelope.id,
		callId: inferCallId(input.envelope.payload),
		payload: {
			envelopeId: input.envelope.id,
			actorId: input.envelope.toActor,
			error: input.error,
			status: input.envelope.status
		},
		createdAt: input.now
	}]

	if (input.envelope.status === 'dead' && input.nextIntentState?.intentId && input.nextIntentState.status === 'failed') {
		events.push({
			type: 'intent.status_changed',
			visibility: eventVisibilityForType('intent.status_changed'),
			runId: input.envelope.runId,
			intentId: input.nextIntentState.intentId,
			actorId: input.envelope.toActor,
			envelopeId: input.envelope.id,
			callId: inferCallId(input.envelope.payload),
			payload: {
				intentId: input.nextIntentState.intentId,
				status: 'failed',
				summary: input.nextIntentState.summary,
				title: input.nextIntentState.title
			},
			createdAt: input.now
		})
	}

	return events
}

function buildCommitEvents(input: {
	actor: ActorRecord
	newActorState: unknown
	inputEnvelope: EnvelopeRecord
	actorEvents: Required<Pick<ActorEventInput, 'id' | 'actorId' | 'eventType' | 'event' | 'createdAt'>>[] & Array<ActorEventInput>
	outgoingEnvelopes: EnvelopeRecord[]
	contextItems: ContextItemRecord[]
	now: string
}): EventInput[] {
	const events: EventInput[] = []
	const intentId = inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload)
	const envelopeCallId = inferCallId(input.inputEnvelope.payload)

	events.push({
		type: 'runtime.envelope.completed',
		visibility: eventVisibilityForType('runtime.envelope.completed'),
		runId: input.inputEnvelope.runId,
		intentId,
		actorId: input.actor.id,
		envelopeId: input.inputEnvelope.id,
		callId: envelopeCallId,
		payload: {
			envelopeId: input.inputEnvelope.id,
			actorId: input.actor.id,
			envelopeType: input.inputEnvelope.type,
			runId: input.inputEnvelope.runId
		},
		createdAt: input.now
	})

	events.push({
		type: 'actor.io.inbound',
		visibility: eventVisibilityForType('actor.io.inbound'),
		runId: input.inputEnvelope.runId,
		intentId,
		actorId: input.actor.id,
		envelopeId: input.inputEnvelope.id,
		callId: envelopeCallId,
		payload: {
			actorId: input.actor.id,
			fromActor: input.inputEnvelope.fromActor,
			toActor: input.inputEnvelope.toActor,
			envelopeId: input.inputEnvelope.id,
			envelopeType: input.inputEnvelope.type,
			runId: input.inputEnvelope.runId,
			payload: input.inputEnvelope.payload
		},
		createdAt: input.now
	})

	for (const actorEvent of input.actorEvents) {
		events.push({
			type: 'actor.event',
			visibility: eventVisibilityForType('actor.event'),
			runId: input.inputEnvelope.runId,
			intentId: inferIntentId(actorEvent.actorId, input.newActorState, actorEvent.event),
			actorId: actorEvent.actorId,
			envelopeId: actorEvent.envelopeId ?? input.inputEnvelope.id,
			callId: inferCallId(actorEvent.event),
			payload: {
				actorId: actorEvent.actorId,
				eventType: actorEvent.eventType,
				event: actorEvent.event
			},
			createdAt: toIsoUtcString(actorEvent.createdAt, input.now)
		})
	}

	for (const contextItem of input.contextItems) {
		events.push({
			type: 'context.appended',
			visibility: eventVisibilityForType('context.appended'),
			runId: contextItem.runId,
			intentId: contextItem.intentId,
			actorId: contextItem.actorId,
				envelopeId: contextItem.envelopeId,
			callId: contextItem.callId,
			payload: {
				seq: contextItem.seq,
				kind: contextItem.kind,
					visibility: contextItem.visibility,
				key: contextItem.key,
				summary: contextItem.summary,
				runId: contextItem.runId,
				intentId: contextItem.intentId,
				actorId: contextItem.actorId,
					envelopeId: contextItem.envelopeId,
				callId: contextItem.callId,
					body: contextItem.body,
					artifactUri: contextItem.artifactUri,
				createdAt: contextItem.createdAt
			},
			createdAt: contextItem.createdAt
		})
	}

	for (const outgoing of input.outgoingEnvelopes) {
		events.push(...buildEnvelopeQueuedEvents({ envelope: outgoing, now: input.now }))
		events.push({
			type: 'actor.io.outbound',
			visibility: eventVisibilityForType('actor.io.outbound'),
			runId: outgoing.runId,
			intentId: inferIntentId(outgoing.toActor, input.newActorState, outgoing.payload),
			actorId: input.actor.id,
			envelopeId: outgoing.id,
			callId: inferCallId(outgoing.payload),
			payload: {
				actorId: input.actor.id,
				fromActor: outgoing.fromActor,
				toActor: outgoing.toActor,
				envelopeId: outgoing.id,
				envelopeType: outgoing.type,
				runId: outgoing.runId,
				payload: outgoing.payload
			},
			createdAt: input.now
		})
	}

	const previousIntentState = input.actor.kind === 'intent' ? toIntentState(input.actor.state) : null
	const nextIntentState = input.actor.kind === 'intent' ? toIntentState(input.newActorState) : null

	if (input.actor.kind === 'intent' && intentId && input.inputEnvelope.type === 'intent.start' && input.actor.version === 0) {
		events.push({
			type: 'intent.created',
			visibility: eventVisibilityForType('intent.created'),
			runId: input.inputEnvelope.runId,
			intentId,
			actorId: input.actor.id,
			envelopeId: input.inputEnvelope.id,
			callId: envelopeCallId,
			payload: {
				intentId,
				title: nextIntentState?.title,
				goal: nextIntentState?.goal,
				status: nextIntentState?.status,
				summary: nextIntentState?.summary
			},
			createdAt: input.now
		})
	}

	if (input.actor.kind === 'intent' && intentId && nextIntentState && (!previousIntentState || previousIntentState.status !== nextIntentState.status || previousIntentState.summary !== nextIntentState.summary)) {
		events.push({
			type: 'intent.status_changed',
			visibility: eventVisibilityForType('intent.status_changed'),
			runId: input.inputEnvelope.runId,
			intentId,
			actorId: input.actor.id,
			envelopeId: input.inputEnvelope.id,
			callId: envelopeCallId,
			payload: {
				intentId,
				status: nextIntentState.status,
				summary: nextIntentState.summary,
				title: nextIntentState.title
			},
			createdAt: input.now
		})
	}

	if (input.actor.kind === 'intent' && intentId) {
		for (const outgoing of input.outgoingEnvelopes) {
			if (outgoing.type === 'skill.request') {
				events.push({
					type: 'intent.skill_call_started',
					visibility: eventVisibilityForType('intent.skill_call_started'),
					runId: outgoing.runId,
					intentId: inferIntentId(input.actor.id, input.newActorState, outgoing.payload),
					actorId: input.actor.id,
					envelopeId: outgoing.id,
					callId: readString((outgoing.payload as Record<string, unknown>)?.callId),
					payload: {
						intentId,
						callId: readString((outgoing.payload as Record<string, unknown>)?.callId),
						skillId: parseSkillId(outgoing.toActor),
						request: readString((outgoing.payload as Record<string, unknown>)?.request)
					},
					createdAt: input.now
				})
			}

			if (outgoing.toActor === HUMAN_ACTOR_ID && (outgoing.type === 'human.message' || outgoing.type === 'human.question')) {
				events.push({
					type: 'intent.message_to_user',
					visibility: eventVisibilityForType('intent.message_to_user'),
					runId: outgoing.runId,
					intentId: inferIntentId(input.actor.id, input.newActorState, outgoing.payload),
					actorId: input.actor.id,
					envelopeId: outgoing.id,
					callId: inferCallId(outgoing.payload),
					payload: {
						intentId,
						messageType: outgoing.type,
						...(typeof outgoing.payload === 'object' && outgoing.payload ? (outgoing.payload as Record<string, unknown>) : {})
					},
					createdAt: input.now
				})
			}
		}

		if (input.inputEnvelope.type === 'skill.result' || input.inputEnvelope.type === 'skill.failed' || input.inputEnvelope.type === 'skill.needs_clarification') {
			const payload = typeof input.inputEnvelope.payload === 'object' && input.inputEnvelope.payload ? input.inputEnvelope.payload : {}
			events.push({
				type: 'intent.skill_call_completed',
				visibility: eventVisibilityForType('intent.skill_call_completed'),
				runId: input.inputEnvelope.runId,
				intentId,
				actorId: input.actor.id,
				envelopeId: input.inputEnvelope.id,
				callId: inferCallId(payload),
				payload: {
					intentId,
					messageType: input.inputEnvelope.type,
					...(payload as Record<string, unknown>)
				},
				createdAt: input.now
			})
		}
	}

	const supervisorIntentId = inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload)
	if (input.actor.kind === 'skill-supervisor') {
		for (const outgoing of input.outgoingEnvelopes) {
			if (parseSkillWorkerActorId(outgoing.toActor)) {
				const type = hasInitialState(outgoing.payload) ? 'skill.worker_spawned' : 'skill.worker_routed'
				events.push({
					type,
					visibility: eventVisibilityForType(type),
					runId: outgoing.runId,
					intentId: inferIntentId(outgoing.toActor, input.newActorState, outgoing.payload) ?? supervisorIntentId,
					actorId: input.actor.id,
					envelopeId: outgoing.id,
					callId: inferCallId(outgoing.payload),
					payload: {
						skillId: parseSkillId(input.actor.id),
						workerActorId: outgoing.toActor,
						workerName: parseSkillWorkerActorId(outgoing.toActor)?.workerName ?? parseActorId(outgoing.toActor).name
					},
					createdAt: input.now
				})
			}
		}

		if (input.inputEnvelope.type === 'skill.worker.result') {
			events.push({
				type: 'skill.worker_completed',
				visibility: eventVisibilityForType('skill.worker_completed'),
				runId: input.inputEnvelope.runId,
				intentId: inferIntentId(input.actor.id, input.newActorState, input.inputEnvelope.payload) ?? supervisorIntentId,
				actorId: input.actor.id,
				envelopeId: input.inputEnvelope.id,
				callId: inferCallId(input.inputEnvelope.payload),
				payload: typeof input.inputEnvelope.payload === 'object' && input.inputEnvelope.payload ? input.inputEnvelope.payload : {},
				createdAt: input.now
			})
		}
	}

	return events
}

function eventVisibilityForType(type: string): 'chat' | 'worklog' | 'debug' {
	if (
		type === 'intent.created' ||
		type === 'intent.status_changed' ||
		type === 'intent.message_to_user' ||
		type === 'runtime.envelope.failed'
	) {
		return 'chat'
	}
	if (
		type === 'intent.skill_call_started' ||
		type === 'intent.skill_call_completed' ||
		type === 'skill.worker_spawned' ||
		type === 'skill.worker_routed' ||
		type === 'skill.worker_completed' ||
		type === 'context.appended'
	) {
		return 'worklog'
	}
	return 'debug'
}

function inferCallId(payload: unknown): string | null {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return null
	}
	const record = payload as Record<string, unknown>
	return readString(record.callId) ?? readString(toRecord(record.input).callId) ?? readString(toRecord(record.result).callId)
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function inferIntentId(actorId: string | null | undefined, state: unknown, payload: unknown): string | null {
	if (actorId && parseIntentActorId(actorId)) {
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
	return parseIntentActorId(actorId) ?? actorId
}

function parseSkillId(actorId: string | null | undefined): string | null {
	if (!actorId) return null
	return parseSkillActorId(actorId)?.skillId ?? null
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

function mapActorHierarchyRecord(
	actorId: string,
	kind: string | null,
	createdAt: string | null,
	updatedAt: string | null,
	observedOnly: boolean,
	root: ReturnType<typeof assertCanonicalActorId>
): ActorHierarchyRecord {
	const parsed = assertCanonicalActorId(actorId)
	return {
		actorId,
		parentActorId: parsed.parentId ?? null,
		kind: kind ?? parsed.kind,
		name: parsed.name,
		depth: Math.max(0, parsed.segments.length - root.segments.length),
		isCurrent: !observedOnly && createdAt !== null,
		firstSeenAt: createdAt,
		lastSeenAt: updatedAt
	}
}

function visibilityWhereClause(view: 'chat' | 'deep-dive', alias = ''): string {
	if (view === 'deep-dive') {
		return ''
	}
	const prefix = alias ? `${alias}.` : ''
	return `AND ${prefix}visibility IN ('chat', 'worklog')`
}

function resolveCommunicationSelector(input: {
	runId?: string
	intentId?: string
	rootEnvelopeId?: string
}): { rootWhere: string; params: string[] } {
	if (input.rootEnvelopeId) {
		return {
			rootWhere: 'e.id = ?',
			params: [input.rootEnvelopeId]
		}
	}

	if (input.intentId) {
		return {
			rootWhere: `e.run_id IN (
				SELECT run_id FROM envelopes WHERE to_actor = ? OR from_actor = ?
			) AND e.caused_by IS NULL`,
			params: [createIntentActorId(input.intentId), createIntentActorId(input.intentId)]
		}
	}

	if (input.runId) {
		return {
			rootWhere: 'e.run_id = ? AND e.caused_by IS NULL',
			params: [input.runId]
		}
	}

	throw new Error('listCommunicationTree requires runId, intentId, or rootEnvelopeId')
}

function query(db: SqliteDatabase, sql: string): SqliteStatement {
	return db.query(sql)
}