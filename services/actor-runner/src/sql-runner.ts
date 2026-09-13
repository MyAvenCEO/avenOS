import { createHash, randomUUID } from 'node:crypto'
import { abortable } from '@avenos/actors/abort'
import {
	assertPlanRunTransition,
	type PlanRunCheckpoint,
	type PlanRunContinuation,
	type PlanRunContinuationSubmission,
	type PlanRunExecutionContext,
	type PlanRunExecutionResult,
	type PlanRunExecutor,
	type PlanRunHandle,
	type PlanRunner,
	type PlanRunRecord,
	type PlanRunStartRequest,
	portableRunClone
} from '@avenos/actors/run'
import type pg from 'pg'

export class PlanRunConflict extends Error {}
export class CustomerExecutionPaused extends Error {
	constructor() {
		super('Work is paused while this workspace is recovered.')
	}
}

const handle = (record: PlanRunRecord): PlanRunHandle => ({
	runId: record.runId,
	revision: record.revision,
	state: record.state,
	executionEnvironment: record.executionEnvironment
})

const stableJson = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
		.join(',')}}`
}

const materialHash = (request: PlanRunStartRequest): string =>
	createHash('sha256')
		.update(
			stableJson({
				protocol: request.protocol,
				skillRef: request.skillRef,
				executionEnvironment: request.executionEnvironment,
				ingredients: request.ingredients,
				goals: request.goals,
				...(request.goalSpec && { goalSpec: request.goalSpec }),
				parameters: request.parameters
			})
		)
		.digest('hex')

export class SqlPlanRunner implements PlanRunner {
	readonly #active = new Map<string, AbortController>()
	readonly #tasks = new Set<Promise<unknown>>()
	readonly #contexts = new Map<string, PlanRunExecutionContext>()
	#closed = false
	#recovery?: Promise<number>
	readonly #timer: ReturnType<typeof setInterval>

	constructor(
		private readonly api: pg.Pool,
		private readonly worker: pg.Pool,
		private readonly executor: PlanRunExecutor,
		private readonly customerExecutionBarrier = false,
		private readonly executionTimeoutMs = 15 * 60_000
	) {
		this.#timer = setInterval(() => {
			if (!this.#closed) void this.recoverAcceptedRuns().catch((error) => this.log(error))
		}, 5_000)
		this.#timer.unref?.()
	}
	private log(error: unknown): void {
		console.error('Actor execution repository failure', error)
	}
	private launch(
		runId: string,
		context?: PlanRunExecutionContext,
		submission?: PlanRunContinuationSubmission
	): void {
		if (this.#closed) return
		if (context) this.#contexts.set(runId, context)
		const task = this.execute(runId, context, submission).catch((error) => this.log(error))
		this.#tasks.add(task)
		void task.finally(() => this.#tasks.delete(task))
	}
	get busy(): boolean {
		return this.#active.size > 0 || this.#tasks.size > 0 || Boolean(this.#recovery)
	}
	async close(): Promise<void> {
		this.#closed = true
		clearInterval(this.#timer)
		this.#contexts.clear()
		for (const controller of this.#active.values())
			controller.abort(new Error('Actor Runner is shutting down.'))
		await Promise.allSettled([...this.#tasks, ...(this.#recovery ? [this.#recovery] : [])])
	}

	async start(
		request: PlanRunStartRequest,
		context?: PlanRunExecutionContext
	): Promise<PlanRunHandle> {
		const admitted = portableRunClone(request)
		if (admitted.executionEnvironment !== 'server')
			throw new Error('the server runner accepts only server placement')
		if (
			this.customerExecutionBarrier &&
			(
				await this.api.query<{ execution_enabled: boolean }>(
					'SELECT execution_enabled FROM aven_platform.environment_identity WHERE singleton'
				)
			).rows[0]?.execution_enabled !== true
		)
			throw new CustomerExecutionPaused()
		const hash = materialHash(admitted)
		const now = new Date().toISOString()
		const record: PlanRunRecord = {
			protocol: admitted.protocol,
			runId: randomUUID(),
			revision: 1,
			state: 'accepted',
			executionEnvironment: admitted.executionEnvironment,
			requestId: admitted.requestId,
			idempotencyKey: admitted.idempotencyKey,
			requestedAt: admitted.requestedAt,
			skillRef: admitted.skillRef,
			security: admitted.security,
			createdAt: now,
			updatedAt: now,
			ingredients: admitted.ingredients,
			goals: admitted.goals,
			...(admitted.goalSpec && { goalSpec: admitted.goalSpec }),
			parameters: admitted.parameters,
			checkpoints: [],
			continuations: []
		}
		const inserted = await this.api.query(
			`INSERT INTO runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
			 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(subject_id,idempotency_key) DO NOTHING`,
			[
				record.runId,
				admitted.security.principal.subjectId,
				admitted.idempotencyKey,
				hash,
				record.state,
				record.revision,
				record
			]
		)
		if (!inserted.rowCount) {
			const prior = (
				await this.api.query<{ material_hash: string; record: PlanRunRecord }>(
					'SELECT material_hash,record FROM runs WHERE subject_id=$1 AND idempotency_key=$2',
					[admitted.security.principal.subjectId, admitted.idempotencyKey]
				)
			).rows[0]
			if (!prior || prior.material_hash !== hash)
				throw new PlanRunConflict('the idempotency key is already bound to another command')
			return portableRunClone(handle(prior.record))
		}
		queueMicrotask(() => this.launch(record.runId, context))
		return portableRunClone(handle(record))
	}

	async status(runId: string): Promise<PlanRunRecord | null> {
		const row = (
			await this.api.query<{ record: PlanRunRecord }>('SELECT record FROM runs WHERE id=$1', [
				runId
			])
		).rows[0]
		return row ? portableRunClone(row.record) : null
	}

	/** Queue recovery independently of HTTP requests. Never replay an expired execution lease. */
	recoverAcceptedRuns(): Promise<number> {
		if (this.#recovery) return this.#recovery
		this.#recovery = this.recover().finally(() => {
			this.#recovery = undefined
		})
		return this.#recovery
	}
	private async recover(): Promise<number> {
		const abandoned = await this.worker.query<{ id: string }>(
			`SELECT id FROM runs WHERE state='running' AND COALESCE((record->'lease'->>'expiresAt')::timestamptz,updated_at) < clock_timestamp()`
		)
		for (const { id } of abandoned.rows) {
			await this.worker.query(
				`UPDATE runs SET state='failed',revision=revision+1,record=(record - 'lease') || jsonb_build_object('state','failed','revision',revision+1,'failure',jsonb_build_object('code','EXECUTION_UNCERTAIN','message','An interrupted execution requires reconciliation before retry.','retryable',false)),updated_at=clock_timestamp() WHERE id=$1 AND state='running' AND COALESCE((record->'lease'->>'expiresAt')::timestamptz,updated_at) < clock_timestamp()`,
				[id]
			)
		}
		const accepted = await this.worker.query<{ id: string }>(
			`SELECT id FROM runs WHERE state IN ('accepted','planning') ORDER BY created_at,id LIMIT 16`
		)
		const executed = await Promise.all(accepted.rows.map(({ id }) => this.execute(id)))
		return executed.filter(Boolean).length
	}
	async retry(
		runId: string,
		requestId: string,
		context?: PlanRunExecutionContext
	): Promise<PlanRunHandle> {
		const connection = await this.worker.connect()
		let record: PlanRunRecord
		try {
			await connection.query('BEGIN')
			const row = await connection.query<{ record: PlanRunRecord }>(
				'SELECT record FROM runs WHERE id=$1 FOR UPDATE',
				[runId]
			)
			if (!row.rows[0]) throw new PlanRunConflict('run not found')
			record = row.rows[0].record
			if (record.retryRequestId === requestId) {
				await connection.query('COMMIT')
				return handle(record)
			}
			if (record.state !== 'failed' || record.failure?.code === 'EXECUTION_UNCERTAIN')
				throw new PlanRunConflict('This run cannot be retried before reconciliation.')
			if (this.customerExecutionBarrier) {
				const row = await connection.query<{ blocked: boolean }>(
					`SELECT NOT execution_enabled OR $1::uuid=ANY(execution_unsettled) AS blocked FROM aven_platform.environment_identity WHERE singleton`,
					[runId]
				)
				if (row.rows[0]?.blocked !== false) throw new CustomerExecutionPaused()
			}
			assertPlanRunTransition(record.state, 'planning')
			record.attemptFailures = [
				...(record.attemptFailures ?? []),
				{ message: record.failure?.message ?? 'Execution failed', endedAt: record.updatedAt }
			]
			record.state = 'planning'
			record.retryRequestId = requestId
			record.attemptCount = (record.attemptCount ?? 1) + 1
			delete record.failure
			delete record.progress
			record.revision++
			record.updatedAt = new Date().toISOString()
			await connection.query(
				'UPDATE runs SET state=$2,revision=$3,record=$4,updated_at=clock_timestamp() WHERE id=$1',
				[runId, record.state, record.revision, record]
			)
			await connection.query('COMMIT')
		} catch (error) {
			await connection.query('ROLLBACK')
			throw error
		} finally {
			connection.release()
		}
		this.launch(runId, context)
		return handle(record!)
	}
	async resume(
		runId: string,
		submission: PlanRunContinuationSubmission,
		context?: PlanRunExecutionContext
	): Promise<PlanRunHandle> {
		portableRunClone(submission)
		const record = await this.status(runId)
		if (record?.state !== 'waiting_for_input')
			throw new PlanRunConflict('the run is not waiting for input')
		const continuation = requiredContinuation(record, submission.continuationId)
		if (submission.action === 'postpone') {
			continuation.state = 'postponed'
			record.revision++
			const saved = await this.api.query(
				`UPDATE runs SET revision=$2,record=$3 WHERE id=$1 AND revision=$4`,
				[runId, record.revision, record, record.revision - 1]
			)
			if (!saved.rowCount) throw new PlanRunConflict('the actor run changed concurrently')
		} else {
			if (submission.kind !== continuation.kind)
				throw new PlanRunConflict('continuation kind mismatch')
			if (this.#closed || this.#active.size >= 2 || this.#active.has(runId))
				throw new PlanRunConflict(
					'Execution is busy; submit the continuation again when capacity is available.'
				)
			// Submission is carried only in memory; a crash never replays secret values.
			this.launch(runId, context, submission)
		}
		return handle(record)
	}
	async cancel(runId: string, _requestId: string): Promise<PlanRunHandle> {
		const record = await this.status(runId)
		if (!record) throw new PlanRunConflict('run not found')
		if (record.state === 'cancelled') return handle(record)
		if (record.state === 'succeeded')
			throw new PlanRunConflict('A completed run cannot be cancelled.')
		try {
			assertPlanRunTransition(record.state, 'cancelled')
		} catch {
			throw new PlanRunConflict(`Cannot cancel a ${record.state} run.`)
		}
		record.state = 'cancelled'
		record.revision++
		record.updatedAt = new Date().toISOString()
		const saved = await this.api.query(
			`UPDATE runs SET state=$2,revision=$3,record=$4,updated_at=clock_timestamp() WHERE id=$1 AND revision=$5`,
			[runId, record.state, record.revision, record, record.revision - 1]
		)
		if (!saved.rowCount) throw new PlanRunConflict('the actor run changed concurrently')
		this.#contexts.delete(runId)
		this.#active.get(runId)?.abort(new Error('Execution cancelled.'))
		return handle(record)
	}
	private async execute(
		runId: string,
		context?: PlanRunExecutionContext,
		submission?: PlanRunContinuationSubmission
	): Promise<boolean> {
		if (this.#closed || this.#active.has(runId) || this.#active.size >= 2) return false
		const controller = new AbortController()
		this.#active.set(runId, controller)
		let record: PlanRunRecord | undefined
		const ownerId = randomUUID()
		let heartbeat: ReturnType<typeof setInterval> | undefined
		let timer: ReturnType<typeof setTimeout> | undefined
		let execution: Promise<PlanRunExecutionResult> | undefined
		let settled = false
		const connection = await this.worker.connect().catch((error) => {
			this.#active.delete(runId)
			throw error
		})
		try {
			await connection.query('BEGIN')
			if (this.customerExecutionBarrier) {
				await connection.query(
					"SELECT pg_advisory_xact_lock_shared(hashtextextended('aven-customer-execution',0))"
				)
				const state = await connection.query<{ execution_enabled: boolean }>(
					`SELECT execution_enabled FROM aven_platform.environment_identity WHERE singleton`
				)
				if (state.rows[0]?.execution_enabled !== true) {
					await connection.query('ROLLBACK')
					return false
				}
			}
			const row = await connection.query<{ record: PlanRunRecord }>(
				`SELECT record FROM runs WHERE id=$1 AND state=ANY($2::text[]) FOR UPDATE SKIP LOCKED`,
				[runId, submission ? ['waiting_for_input'] : ['accepted', 'planning']]
			)
			if (!row.rows[0]) {
				await connection.query('ROLLBACK')
				return false
			}
			record = row.rows[0].record
			if (submission) requiredContinuation(record, submission.continuationId)
			if (this.customerExecutionBarrier) {
				const marked = await connection.query(
					`UPDATE aven_platform.environment_identity SET execution_unsettled=array_append(execution_unsettled,$1::uuid) WHERE singleton AND execution_enabled AND NOT ($1::uuid=ANY(execution_unsettled)) RETURNING singleton`,
					[runId]
				)
				if (!marked.rowCount) {
					record.state = 'failed'
					record.failure = {
						code: 'EXECUTION_UNCERTAIN',
						message: 'A previous execution requires reconciliation before retry.',
						retryable: false
					}
					record.revision++
					record.updatedAt = new Date().toISOString()
					await connection.query(
						'UPDATE runs SET state=$2,revision=$3,record=$4,updated_at=clock_timestamp() WHERE id=$1',
						[runId, record.state, record.revision, record]
					)
					await connection.query('COMMIT')
					this.#active.delete(runId)
					this.#contexts.delete(runId)
					return false
				}
			}
			if (record.state === 'accepted') {
				assertPlanRunTransition(record.state, 'planning')
				record.state = 'planning'
			}
			assertPlanRunTransition(record.state, 'running')
			record.state = 'running'
			record.revision++
			record.updatedAt = new Date().toISOString()
			record.lease = { ownerId, expiresAt: new Date(Date.now() + 30_000).toISOString() }
			await connection.query(
				`UPDATE runs SET state=$2,revision=$3,record=$4,updated_at=clock_timestamp() WHERE id=$1`,
				[runId, record.state, record.revision, record]
			)
			await connection.query('COMMIT')
		} catch (error) {
			await connection.query('ROLLBACK')
			this.#active.delete(runId)
			throw error
		} finally {
			connection.release()
			if (!record) this.#active.delete(runId)
		}
		if (!record) {
			this.#contexts.delete(runId)
			return false
		}
		context ??= this.#contexts.get(runId)
		this.#contexts.delete(runId)
		const owned = () => [runId, ownerId]
		const keepAlive = async () => {
			const saved = await this.worker.query(
				`UPDATE runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()+interval '30 seconds')::text)),updated_at=clock_timestamp() WHERE id=$1 AND state='running' AND record->'lease'->>'ownerId'=$2`,
				owned()
			)
			if (!saved.rowCount) controller.abort(new Error('Execution ownership ended.'))
		}
		heartbeat = setInterval(() => {
			void keepAlive().catch((error) => {
				controller.abort(error)
				this.log(error)
			})
		}, 5_000)
		heartbeat.unref?.()
		const resetDeadline = () => {
			clearTimeout(timer)
			timer = setTimeout(
				() => controller.abort(new Error('Actor execution made no progress before its deadline.')),
				this.executionTimeoutMs
			)
		}
		resetDeadline()
		const signal = context?.signal
			? AbortSignal.any([context.signal, controller.signal])
			: controller.signal
		try {
			execution = Promise.resolve().then(() =>
				this.executor(this.#request(record!), {
					...context,
					signal,
					...(submission?.action === 'submit' && { submission }),
					reportProgress: async (progress) => {
						signal.throwIfAborted()
						const saved = await this.worker.query(
							`UPDATE runs SET revision=revision+1,record=jsonb_set(jsonb_set(record,'{progress}',$3::jsonb),'{revision}',to_jsonb(revision+1)),updated_at=clock_timestamp() WHERE id=$1 AND state='running' AND record->'lease'->>'ownerId'=$2`,
							[...owned(), portableRunClone(progress)]
						)
						if (!saved.rowCount) throw new PlanRunConflict('the actor run is no longer active')
						resetDeadline()
					}
				})
			)
			execution.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				}
			)
			const result = await abortable(execution, signal)
			this.#applyResult(
				record,
				result,
				submission ? requiredContinuation(record, submission.continuationId) : undefined
			)
		} catch (error) {
			record.state = 'failed'
			record.failure = {
				code: 'EXECUTION_FAILED',
				message:
					submission?.action === 'submit' && submission.kind === 'secret'
						? 'Secret continuation execution failed.'
						: error instanceof Error
							? error.message
							: String(error),
				retryable: true
			}
		} finally {
			clearInterval(heartbeat)
			clearTimeout(timer)
		}
		try {
			record.updatedAt = new Date().toISOString()
			// Update only this lease. A concurrent cancel wins over completion.
			await this.worker.query(
				`UPDATE runs SET state=$3,revision=revision+1,record=($4::jsonb - 'lease') || jsonb_build_object('revision',revision+1),updated_at=clock_timestamp() WHERE id=$1 AND state='running' AND record->'lease'->>'ownerId'=$2`,
				[...owned(), record.state, record]
			)
		} catch (error) {
			this.#active.delete(runId)
			throw error
		}
		{
			const clean = async () => {
				if (this.customerExecutionBarrier)
					await this.worker.query(
						`UPDATE aven_platform.environment_identity SET execution_unsettled=array_remove(execution_unsettled,$1::uuid) WHERE singleton`,
						[runId]
					)
				this.#active.delete(runId)
			}
			// A timeout is not proof an arbitrary executor stopped. Keep the marker until it settles.
			if (settled) await clean()
			else if (execution) void execution.then(clean, clean).catch((error) => this.log(error))
			else this.#active.delete(runId)
		}
		return true
	}

	#request(record: PlanRunRecord): PlanRunStartRequest {
		return portableRunClone({
			protocol: record.protocol,
			requestId: record.requestId,
			idempotencyKey: record.idempotencyKey,
			requestedAt: record.requestedAt,
			skillRef: record.skillRef,
			executionEnvironment: record.executionEnvironment,
			ingredients: record.ingredients,
			goals: record.goals,
			...(record.goalSpec && { goalSpec: record.goalSpec }),
			parameters: record.parameters,
			security: record.security
		})
	}

	#applyResult(
		record: PlanRunRecord,
		result: PlanRunExecutionResult,
		resolved?: PlanRunContinuation
	): void {
		const remainingGoals = result.remainingGoals ?? []
		if (result.continuation) {
			assertContinuation(result.continuation)
			if (remainingGoals.length === 0) {
				throw new Error('a continuation must retain at least one unfinished goal')
			}
			if (resolved && resolved.continuationId !== result.continuation.continuationId) {
				resolved.state = 'resolved'
			}
			upsertContinuation(record, result.continuation)
			record.state = 'waiting_for_input'
		} else {
			if (remainingGoals.length > 0) {
				throw new Error(`executor left unmet goals: ${remainingGoals.join(', ')}`)
			}
			if (resolved) resolved.state = 'resolved'
			record.state = 'succeeded'
		}
		record.checkpoints.push(checkpoint(record, result))
	}
}

function requiredContinuation(record: PlanRunRecord, continuationId: string): PlanRunContinuation {
	const continuation = record.continuations.find(
		(candidate) =>
			candidate.continuationId === continuationId &&
			(candidate.state === 'open' || candidate.state === 'postponed')
	)
	if (!continuation) throw new PlanRunConflict('Continuation is not open.')
	return continuation
}

function assertContinuation(continuation: PlanRunContinuation): void {
	portableRunClone(continuation)
	if (continuation.state !== 'open') throw new Error('executor continuation must be open')
	if (continuation.kind === 'secret' && continuation.persistence !== 'metadata-only') {
		throw new Error('secret continuation metadata cannot request artifact persistence')
	}
}

function upsertContinuation(record: PlanRunRecord, continuation: PlanRunContinuation): void {
	const index = record.continuations.findIndex(
		(candidate) => candidate.continuationId === continuation.continuationId
	)
	const persisted = portableRunClone(continuation)
	if (index < 0) record.continuations.push(persisted)
	else record.continuations[index] = persisted
}

function checkpoint(record: PlanRunRecord, result: PlanRunExecutionResult): PlanRunCheckpoint {
	if (result.output) portableRunClone(result.output)
	return {
		checkpointId: randomUUID(),
		ordinal: record.checkpoints.length,
		committedAt: new Date().toISOString(),
		completedStepIds: [...(result.completedStepIds ?? [])],
		artifactIds: [...(result.artifactIds ?? [])],
		remainingGoals: [...(result.remainingGoals ?? [])],
		registryRevision: result.registryRevision ?? 0,
		policyDecisionIds: [...(result.policyDecisionIds ?? [])],
		...(result.output && { output: portableRunClone(result.output) })
	}
}
