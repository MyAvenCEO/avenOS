import { createHash, randomUUID } from 'node:crypto'
import {
	assertPlanRunTransition,
	type PlanRunContinuationSubmission,
	type PlanRunHandle,
	type PlanRunner,
	type PlanRunRecord,
	type PlanRunStartRequest,
	portableRunClone
} from '@avenos/actors/run'
import type pg from 'pg'

export class PlanRunConflict extends Error {}

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
				parameters: request.parameters
			})
		)
		.digest('hex')

export class SqlPlanRunner implements PlanRunner {
	constructor(
		private readonly api: pg.Pool,
		private readonly worker: pg.Pool
	) {}

	async start(request: PlanRunStartRequest): Promise<PlanRunHandle> {
		const admitted = portableRunClone(request)
		if (admitted.executionEnvironment !== 'server')
			throw new Error('the server runner accepts only server placement')
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
			skillRef: admitted.skillRef,
			security: admitted.security,
			createdAt: now,
			updatedAt: now,
			ingredients: admitted.ingredients,
			goals: admitted.goals,
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
		queueMicrotask(() => void this.execute(record.runId).catch(() => {}))
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

	/** Resume work that was durably admitted before this runner process started. */
	async recoverAcceptedRuns(): Promise<number> {
		const accepted = await this.worker.query<{ id: string }>(
			`SELECT id FROM runs WHERE state='accepted' ORDER BY created_at,id`
		)
		let recovered = 0
		for (const { id } of accepted.rows) {
			if (await this.execute(id)) recovered += 1
		}
		return recovered
	}

	async resume(_runId: string, _submission: PlanRunContinuationSubmission): Promise<PlanRunHandle> {
		throw new Error('no durable continuation executor is registered')
	}

	async cancel(runId: string, _requestId: string): Promise<PlanRunHandle> {
		const record = await this.status(runId)
		if (!record) throw new Error('run not found')
		if (record.state === 'cancelled') return handle(record)
		assertPlanRunTransition(record.state, 'cancelled')
		record.state = 'cancelled'
		record.revision += 1
		record.updatedAt = new Date().toISOString()
		const updated = await this.api.query(
			`UPDATE runs SET state=$2,revision=$3,record=$4,updated_at=clock_timestamp()
			 WHERE id=$1 AND revision=$5`,
			[runId, record.state, record.revision, record, record.revision - 1]
		)
		if (!updated.rowCount) throw new PlanRunConflict('the actor run changed concurrently')
		return portableRunClone(handle(record))
	}

	private async execute(runId: string): Promise<boolean> {
		const row = (
			await this.worker.query<{ record: PlanRunRecord }>(
				`SELECT record FROM runs WHERE id=$1 AND state='accepted'`,
				[runId]
			)
		).rows[0]
		if (!row) return false
		const record = row.record
		const facts = new Set(record.ingredients.map((ingredient) => ingredient.predicate))
		const remainingGoals = record.goals.filter((goal) => !facts.has(goal))
		if (remainingGoals.length === 0) {
			record.state = 'succeeded'
			record.checkpoints.push({
				checkpointId: randomUUID(),
				ordinal: 0,
				committedAt: new Date().toISOString(),
				completedStepIds: [],
				artifactIds: [],
				remainingGoals: [],
				registryRevision: 0,
				policyDecisionIds: []
			})
		} else {
			record.state = 'failed'
			record.failure = {
				code: 'EXECUTION_FAILED',
				message: 'no actor executor is registered for the requested goal',
				retryable: false
			}
		}
		record.revision += 1
		record.updatedAt = new Date().toISOString()
		const updated = await this.worker.query(
			`UPDATE runs SET state=$2,revision=$3,record=$4,updated_at=clock_timestamp()
			 WHERE id=$1 AND state='accepted'`,
			[runId, record.state, record.revision, record]
		)
		return Boolean(updated.rowCount)
	}
}
