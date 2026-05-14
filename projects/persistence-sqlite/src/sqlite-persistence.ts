import { createHash, randomUUID } from 'node:crypto'

import { Database } from 'bun:sqlite'

import {
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
	ContextScope,
	ContextSelector,
	CommunicationTreeRecord,
	CommunicationTreeSummary,
	EnvelopeInput,
	EnvelopeRecord,
	Persistence,
	SkillRecord,
	SkillRecordInput,
	StreamEventInput,
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

type ContextItemRow = {
	seq: number
	id: string
	scope_type: 'run' | 'intent' | 'call' | 'actor' | 'global'
	scope_key: string
	correlation_id: string
	intent_id: string | null
	actor_id: string
	call_id: string | null
	parent_call_id: string | null
	root_call_id: string | null
	kind: ContextItemRecord['kind']
	key: string | null
	schema: string | null
	tags_json: string
	body_json: string | null
	artifact_id: string | null
	summary: string | null
	produced_by_actor_id: string
	produced_by_envelope_id: string
	produced_by_command_id: string | null
	produced_by_tool_call_id: string | null
	source_context_item_ids_json: string
	confidence: number | null
	hash: string
	supersedes_item_id: string | null
	redacts_item_id: string | null
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
			const contextRecords = input.contextAppends.map((append) =>
				materializeContextItemRecord({
					append,
					actorId: input.actorId,
					envelope: inputEnvelope,
					now: input.now
				})
			)
			const persistedContextRecords = insertContextItems(this.db, contextRecords)

			const insertEvent = query(
				this.db,
				`INSERT INTO actor_events (id, actor_id, envelope_id, event_type, event_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)

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
					insertEvent.run(
						normalizedEvent.id,
						normalizedEvent.actorId,
						normalizedEvent.envelopeId ?? null,
						normalizedEvent.eventType,
						stringifyJson(normalizedEvent.event),
						toIsoUtcString(normalizedEvent.createdAt, input.now)
					)
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

			insertStreamEvents(
				this.db,
				buildCommitStreamEvents({
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

	async listContextItems(input: {
		selector: ContextSelector
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
		if (!input.selector.includeRedacted) {
			clauses.push('id NOT IN (SELECT redacts_item_id FROM context_items WHERE redacts_item_id IS NOT NULL)')
		}
		if (input.selector.scopes?.length) {
			const scopeClauses = input.selector.scopes.map((scope) => {
				params.push(scope.type, getScopeKey(scope))
				return '(scope_type = ? AND scope_key = ?)'
			})
			clauses.push(`(${scopeClauses.join(' OR ')})`)
		}
		if (input.selector.kinds?.length) {
			clauses.push(`kind IN (${input.selector.kinds.map(() => '?').join(', ')})`)
			params.push(...input.selector.kinds)
		}
		if (input.selector.keys?.length) {
			clauses.push(`key IN (${input.selector.keys.map(() => '?').join(', ')})`)
			params.push(...input.selector.keys)
		}
		if (input.selector.schemas?.length) {
			clauses.push(`schema IN (${input.selector.schemas.map(() => '?').join(', ')})`)
			params.push(...input.selector.schemas)
		}
		if (input.selector.producedByActorIds?.length) {
			clauses.push(`produced_by_actor_id IN (${input.selector.producedByActorIds.map(() => '?').join(', ')})`)
			params.push(...input.selector.producedByActorIds)
		}
		if (input.selector.tags?.length) {
			for (const tag of input.selector.tags) {
				clauses.push('tags_json LIKE ?')
				params.push(`%"${tag}"%`)
			}
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

	async appendStreamEvents(events: StreamEventInput[]): Promise<void> {
		this.withTransaction(() => {
			insertStreamEvents(this.db, events.map((event) => ({
				id: event.id,
				scope: event.scope,
				actorId: event.actorId ?? null,
				envelopeId: event.envelopeId ?? null,
				type: event.type,
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

	async listActorHierarchy(input: { rootActorId: string; observed?: boolean; includeRoot?: boolean }): Promise<ActorHierarchyRecord[]> {
		const root = assertCanonicalActorId(input.rootActorId)
		const prefix = `${input.rootActorId}/%`
		const rows = input.observed
			? (query(
					this.db,
					`WITH observed AS (
					   SELECT actor_id AS actor_id, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
					   FROM stream_events
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
		const rows = query(
			this.db,
				`SELECT * FROM stream_events
				 WHERE seq > ?
				   AND (scope = ? OR scope LIKE ?)
				   ${chatViewWhereClause(view)}
				 ORDER BY seq ASC
				 LIMIT ?`
		)
			.all(input.after ?? 0, `actor/${input.rootActorId}`, prefix, input.limit ?? 200) as StreamEventRow[]
		return rows.map((row) => ({ ...mapStreamEventRow(row), logView: view }))
	}

	async listCommunicationTree(input: {
		correlationId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeRecord[]> {
		const selector = resolveCommunicationSelector(input)
		const rows = query(
			this.db,
				`WITH RECURSIVE roots AS (
				   SELECT e.id, e.causation_id, e.correlation_id, e.from_actor, e.to_actor, e.type, e.payload_json, e.created_at
				   FROM envelopes e
				   WHERE ${selector.rootWhere}
				 ), tree AS (
				   SELECT r.id, r.causation_id, r.correlation_id, r.from_actor, r.to_actor, r.type, r.payload_json, r.created_at, 0 AS depth
				   FROM roots r
				   UNION ALL
				   SELECT e.id, e.causation_id, e.correlation_id, e.from_actor, e.to_actor, e.type, e.payload_json, e.created_at, t.depth + 1
				   FROM envelopes e
				   JOIN tree t ON e.causation_id = t.id
				 )
				 SELECT 'env:' || t.id AS node_id,
				        CASE WHEN t.causation_id IS NULL THEN NULL ELSE 'env:' || t.causation_id END AS parent_node_id,
				        'envelope' AS node_kind,
				        t.depth,
				        t.correlation_id,
				        t.id AS envelope_id,
				        t.to_actor AS actor_id,
				        t.from_actor,
				        t.to_actor,
				        t.type AS event_type,
				        t.payload_json,
				        t.created_at
				 FROM tree t
				 UNION ALL
				 SELECT 'log:' || s.id AS node_id,
				        CASE WHEN s.envelope_id IS NULL THEN NULL ELSE 'env:' || s.envelope_id END AS parent_node_id,
				        'log' AS node_kind,
				        tree.depth + 1 AS depth,
				        tree.correlation_id,
				        s.envelope_id,
				        s.actor_id,
				        json_extract(s.payload_json, '$.fromActor') AS from_actor,
				        json_extract(s.payload_json, '$.toActor') AS to_actor,
				        s.type AS event_type,
				        s.payload_json,
				        s.created_at
				 FROM stream_events s
				 JOIN tree ON s.envelope_id = tree.id
				 WHERE 1=1 ${chatViewWhereClause(input.view ?? 'deep-dive', 's.type')}
				 ORDER BY created_at ASC, node_id ASC`
		)
			.all(...selector.params) as Array<{
				node_id: string
				parent_node_id: string | null
				node_kind: 'envelope' | 'log'
				depth: number
				correlation_id: string | null
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
			correlationId: row.correlation_id,
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
		correlationId?: string
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
				   FROM stream_events
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
				if (!parsed) {
					return null
				}
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

		const childCounts = new Map<string, number>()
		for (const actor of allActors) {
			if (!actor.parentActorId) continue
			childCounts.set(actor.parentActorId, (childCounts.get(actor.parentActorId) ?? 0) + 1)
		}

		return allActors
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
	return actorKindFromId(actorId)
}

function assertActorRecordIdentity(actorId: string, kind: string): void {
	const parsed = assertCanonicalActorId(actorId)
	if (parsed.kind !== kind) {
		throw new Error(`Actor kind mismatch for ${actorId}: expected ${parsed.kind}, got ${kind}`)
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

function mapContextItemRow(row: ContextItemRow): ContextItemRecord {
	return {
		id: row.id,
		seq: row.seq,
		scope: parseContextScope(row),
		kind: row.kind,
		key: row.key ?? undefined,
		schema: row.schema ?? undefined,
		tags: parseJson(row.tags_json),
		body: row.body_json ? parseJson(row.body_json) : undefined,
		artifactId: row.artifact_id ?? undefined,
		summary: row.summary ?? undefined,
		correlationId: row.correlation_id,
		intentId: row.intent_id ?? undefined,
		actorId: row.actor_id,
		callId: row.call_id ?? undefined,
		parentCallId: row.parent_call_id ?? undefined,
		rootCallId: row.root_call_id ?? undefined,
		producedByActorId: row.produced_by_actor_id,
		producedByEnvelopeId: row.produced_by_envelope_id,
		producedByCommandId: row.produced_by_command_id ?? undefined,
		producedByToolCallId: row.produced_by_tool_call_id ?? undefined,
		sourceContextItemIds: parseJson(row.source_context_item_ids_json),
		confidence: row.confidence ?? undefined,
		hash: row.hash,
		createdAt: row.created_at,
		supersedesItemId: row.supersedes_item_id ?? undefined,
		redactsItemId: row.redacts_item_id ?? undefined
	}
}

function insertContextItems(db: SqliteDatabase, items: ContextItemRecord[]): ContextItemRecord[] {
	if (items.length === 0) {
		return []
	}

	const insert = query(
		db,
		`INSERT INTO context_items (
		  id,
		  scope_type,
		  scope_key,
		  correlation_id,
		  intent_id,
		  actor_id,
		  call_id,
		  parent_call_id,
		  root_call_id,
		  kind,
		  key,
		  schema,
		  tags_json,
		  body_json,
		  artifact_id,
		  summary,
		  produced_by_actor_id,
		  produced_by_envelope_id,
		  produced_by_command_id,
		  produced_by_tool_call_id,
		  source_context_item_ids_json,
		  confidence,
		  hash,
		  supersedes_item_id,
		  redacts_item_id,
		  created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)

	const persisted: ContextItemRecord[] = []

	for (const item of items) {
		const result = insert.run(
			item.id,
			item.scope.type,
			getScopeKey(item.scope),
			item.correlationId,
			item.intentId ?? null,
			item.actorId,
			item.callId ?? null,
			item.parentCallId ?? null,
			item.rootCallId ?? null,
			item.kind,
			item.key ?? null,
			item.schema ?? null,
			stringifyJson(item.tags),
			item.body === undefined ? null : stringifyJson(item.body),
			item.artifactId ?? null,
			item.summary ?? null,
			item.producedByActorId,
			item.producedByEnvelopeId,
			item.producedByCommandId ?? null,
			item.producedByToolCallId ?? null,
			stringifyJson(item.sourceContextItemIds),
			item.confidence ?? null,
			item.hash,
			item.supersedesItemId ?? null,
			item.redactsItemId ?? null,
			item.createdAt
		)
		persisted.push({
			...item,
			seq: Number(result.lastInsertRowid)
		})
	}

	return persisted
}

function materializeContextItemRecord(input: {
	append: ContextAppendInput
	actorId: string
	envelope: EnvelopeRecord
	now: Date
}): ContextItemRecord {
	const correlationId = input.envelope.correlationId
	const payload = input.envelope.payload
	const scope = input.append.scope
	const intentId = scope.type === 'intent' ? scope.intentId : readIntentIdFromUnknown(payload) ?? undefined
	const callId = scope.type === 'call' ? scope.callId : inferCallId(payload) ?? undefined
	const parentCallId = scope.type === 'call' ? scope.parentCallId : inferParentCallId(payload) ?? undefined
	const rootCallId =
		scope.type === 'call'
			? scope.rootCallId
			: inferRootCallId(payload) ?? inferParentCallId(payload) ?? inferCallId(payload) ?? undefined
	const producedByActorId = input.actorId
	const producedByEnvelopeId = input.envelope.id
	const createdAt = input.now.toISOString()

	const hash = createHash('sha256')
		.update(
			JSON.stringify({
				scope,
				kind: input.append.kind,
				key: input.append.key,
				schema: input.append.schema,
				tags: input.append.tags,
				body: input.append.body,
				artifactId: input.append.artifactId,
				summary: input.append.summary,
				producedByActorId,
				producedByEnvelopeId,
				producedByCommandId: input.append.producedByCommandId,
				producedByToolCallId: input.append.producedByToolCallId,
				sourceContextItemIds: input.append.sourceContextItemIds
			})
		)
		.digest('hex')

	return {
		id: randomUUID(),
		seq: 0,
		scope,
		kind: input.append.kind,
		key: input.append.key,
		schema: input.append.schema,
		tags: input.append.tags,
		body: input.append.body,
		artifactId: input.append.artifactId,
		summary: input.append.summary,
		correlationId,
		intentId,
		actorId: input.actorId,
		callId,
		parentCallId,
		rootCallId,
		producedByActorId,
		producedByEnvelopeId,
		producedByCommandId: input.append.producedByCommandId,
		producedByToolCallId: input.append.producedByToolCallId,
		sourceContextItemIds: input.append.sourceContextItemIds,
		confidence: input.append.confidence,
		hash,
		createdAt,
		supersedesItemId: input.append.supersedesItemId,
		redactsItemId: input.append.redactsItemId
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
	contextItems: ContextItemRecord[]
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

	streamEvents.push(
		...scopedStreamEvents({
			baseId: `${input.inputEnvelope.id}:actor-io-inbound`,
			actorId: input.actor.id,
			envelopeId: input.inputEnvelope.id,
			type: 'actor.io.inbound',
			payload: {
				actorId: input.actor.id,
				fromActor: input.inputEnvelope.fromActor,
				toActor: input.inputEnvelope.toActor,
				envelopeId: input.inputEnvelope.id,
				envelopeType: input.inputEnvelope.type,
				correlationId: input.inputEnvelope.correlationId,
				payload: input.inputEnvelope.payload
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

	for (const contextItem of input.contextItems) {
		streamEvents.push(
			...scopedStreamEvents({
				baseId: `${contextItem.id}:context-appended`,
				actorId: contextItem.actorId,
				envelopeId: contextItem.producedByEnvelopeId,
				type: 'context.appended',
				payload: {
					id: contextItem.id,
					seq: contextItem.seq,
					scope: contextItem.scope,
					kind: contextItem.kind,
					key: contextItem.key,
					schema: contextItem.schema,
					tags: contextItem.tags,
					summary: contextItem.summary,
					artifactId: contextItem.artifactId,
					correlationId: contextItem.correlationId,
					intentId: contextItem.intentId,
					actorId: contextItem.actorId,
					callId: contextItem.callId,
					parentCallId: contextItem.parentCallId,
					rootCallId: contextItem.rootCallId,
					producedByActorId: contextItem.producedByActorId,
					producedByEnvelopeId: contextItem.producedByEnvelopeId,
					sourceContextItemIds: contextItem.sourceContextItemIds,
					createdAt: contextItem.createdAt
				},
				createdAt: contextItem.createdAt,
				scopes: scopesForContextItem(contextItem)
			})
		)
	}

	for (const outgoing of input.outgoingEnvelopes) {
		streamEvents.push(...buildEnvelopeQueuedStreamEvents({ envelope: outgoing, now: input.now }))
		streamEvents.push(
			...scopedStreamEvents({
				baseId: `${outgoing.id}:actor-io-outbound`,
				actorId: input.actor.id,
				envelopeId: outgoing.id,
				type: 'actor.io.outbound',
				payload: {
					actorId: input.actor.id,
					fromActor: outgoing.fromActor,
					toActor: outgoing.toActor,
					envelopeId: outgoing.id,
					envelopeType: outgoing.type,
					correlationId: outgoing.correlationId,
					payload: outgoing.payload
				},
				createdAt: input.now,
				scopes: scopesForStreamEvent({
					actorId: input.actor.id,
					correlationId: outgoing.correlationId,
					intentId: inferIntentId(outgoing.toActor, input.newActorState, outgoing.payload)
				})
			})
		)
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
			if (parseSkillWorkerActorId(outgoing.toActor)) {
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
	rootCallId?: string | null
	callId?: string | null
}): string[] {
	return [
		'global',
		input.actorId ? `actor/${input.actorId}` : null,
		input.correlationId ? `correlation/${input.correlationId}` : null,
		input.intentId ? `intents/${input.intentId}` : null,
		input.rootCallId ? `calls/${input.rootCallId}` : null,
		input.rootCallId && input.callId ? `calls/${input.rootCallId}/${input.callId}` : null
	].filter(
		(value): value is string => Boolean(value)
	)
}

function scopesForContextItem(item: ContextItemRecord): string[] {
	return scopesForStreamEvent({
		actorId: item.actorId,
		correlationId: item.correlationId,
		intentId: item.intentId,
		rootCallId: item.rootCallId,
		callId: item.callId
	})
}

function getScopeKey(scope: ContextScope): string {
	if (scope.type === 'run') {
		return scope.correlationId
	}

	if (scope.type === 'intent') {
		return scope.intentId
	}

	if (scope.type === 'call') {
		return scope.callId
	}

	if (scope.type === 'actor') {
		return scope.actorId
	}

	return scope.name
}

function parseContextScope(row: ContextItemRow): ContextScope {
	switch (row.scope_type) {
		case 'run':
			return { type: 'run', correlationId: row.scope_key }
		case 'intent':
			return { type: 'intent', intentId: row.scope_key }
		case 'call':
			return {
				type: 'call',
				callId: row.call_id ?? row.scope_key,
				rootCallId: row.root_call_id ?? row.call_id ?? row.scope_key,
				parentCallId: row.parent_call_id ?? undefined
			}
		case 'actor':
			return { type: 'actor', actorId: row.scope_key }
		case 'global':
			return { type: 'global', name: row.scope_key as 'archive' | 'system' }
	}
}

function inferCallId(payload: unknown): string | null {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return null
	}
	const record = payload as Record<string, unknown>
	return readString(record.callId) ?? readString(toRecord(record.input).callId) ?? readString(toRecord(record.result).callId)
}

function inferParentCallId(payload: unknown): string | null {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return null
	}
	const record = payload as Record<string, unknown>
	return readString(record.parentCallId) ?? readString(toRecord(record.input).parentCallId) ?? readString(toRecord(record.result).parentCallId)
}

function inferRootCallId(payload: unknown): string | null {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return null
	}
	const record = payload as Record<string, unknown>
	return readString(record.rootCallId) ?? readString(toRecord(record.input).rootCallId) ?? readString(toRecord(record.result).rootCallId)
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

function parseWorkerId(actorId: string): string | null {
	return parseSkillWorkerActorId(actorId)?.workerId ?? null
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

function chatViewWhereClause(view: 'chat' | 'deep-dive', typeColumn = 'type'): string {
	if (view === 'deep-dive') {
		return ''
	}

	return `AND (${typeColumn} IN (
		'intent.created',
		'intent.status_changed',
		'intent.skill_call_started',
		'intent.skill_call_completed',
		'intent.message_to_user',
		'runtime.envelope.failed',
		'actor.io.prompt',
		'actor.io.task',
		'actor.io.shell',
		'actor.io.inbound',
		'actor.io.outbound'
	))`
	}

function resolveCommunicationSelector(input: {
	correlationId?: string
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
			rootWhere: `e.correlation_id IN (
				SELECT correlation_id FROM envelopes WHERE to_actor = ? OR from_actor = ?
			) AND e.causation_id IS NULL`,
			params: [createIntentActorId(input.intentId), createIntentActorId(input.intentId)]
		}
	}

	if (input.correlationId) {
		return {
			rootWhere: 'e.correlation_id = ? AND e.causation_id IS NULL',
			params: [input.correlationId]
		}
	}

	throw new Error('listCommunicationTree requires correlationId, intentId, or rootEnvelopeId')
}

function query(db: SqliteDatabase, sql: string): SqliteStatement {
	return db.query(sql)
}