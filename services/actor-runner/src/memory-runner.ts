import {
	assertPlanRunTransition,
	type PlanRunCheckpoint,
	type PlanRunContinuationSubmission,
	type PlanRunHandle,
	type PlanRunner,
	type PlanRunRecord,
	type PlanRunStartRequest,
	portableRunClone
} from '@avenos/actors/run'

export interface PlanRunExecutionResult {
	artifactIds?: string[]
	remainingGoals?: string[]
	registryRevision?: number
	policyDecisionIds?: string[]
}

export type PlanRunExecutor = (request: PlanRunStartRequest) => Promise<PlanRunExecutionResult>

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
	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
		left.localeCompare(right)
	)
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}

const materialCommand = (request: PlanRunStartRequest): string =>
	stableJson({
		protocol: request.protocol,
		skillRef: request.skillRef,
		executionEnvironment: request.executionEnvironment,
		ingredients: request.ingredients,
		goals: request.goals,
		parameters: request.parameters
	})

/**
 * Process-local reference runner for development and boundary tests.
 *
 * It implements protocol semantics and asynchronous execution, but deliberately
 * does not pretend to be the durable SQL repository specified for production.
 */
export class MemoryPlanRunner implements PlanRunner {
	readonly #records = new Map<string, PlanRunRecord>()
	readonly #idempotency = new Map<string, { runId: string; material: string }>()

	constructor(private readonly execute: PlanRunExecutor = executeAlreadySatisfied) {}

	async start(request: PlanRunStartRequest): Promise<PlanRunHandle> {
		const admitted = portableRunClone(request)
		if (admitted.executionEnvironment !== 'server') {
			throw new Error('the server runner accepts only server placement')
		}
		const key = `${admitted.security.principal.subjectId}\0${admitted.security.access.tenantId ?? ''}\0${admitted.skillRef}\0${admitted.idempotencyKey}`
		const material = materialCommand(admitted)
		const previous = this.#idempotency.get(key)
		if (previous) {
			if (previous.material !== material) {
				throw new PlanRunConflict('the idempotency key is already bound to another command')
			}
			const record = this.#records.get(previous.runId)
			if (!record) throw new Error('the idempotency index references a missing run')
			return portableRunClone(handle(record))
		}

		const now = new Date().toISOString()
		const record: PlanRunRecord = {
			protocol: admitted.protocol,
			runId: crypto.randomUUID(),
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
		this.#records.set(record.runId, record)
		this.#idempotency.set(key, { runId: record.runId, material })
		queueMicrotask(() => void this.#run(record.runId, admitted))
		return portableRunClone(handle(record))
	}

	async status(runId: string): Promise<PlanRunRecord | null> {
		const record = this.#records.get(runId)
		return record ? portableRunClone(record) : null
	}

	async resume(runId: string, _submission: PlanRunContinuationSubmission): Promise<PlanRunHandle> {
		const record = this.#required(runId)
		if (record.state !== 'waiting_for_input') throw new Error('the run is not waiting for input')
		throw new Error('the memory reference runner has no continuation executor')
	}

	async cancel(runId: string, _requestId: string): Promise<PlanRunHandle> {
		const record = this.#required(runId)
		if (record.state === 'cancelled') return portableRunClone(handle(record))
		assertPlanRunTransition(record.state, 'cancelled')
		this.#transition(record, 'cancelled')
		return portableRunClone(handle(record))
	}

	async #run(runId: string, request: PlanRunStartRequest): Promise<void> {
		const record = this.#required(runId)
		try {
			if (record.state !== 'accepted') return
			this.#transition(record, 'planning')
			this.#transition(record, 'running')
			const result = await this.execute(portableRunClone(request))
			const current = this.#required(runId)
			if (current.state === 'cancelled') return
			const checkpoint: PlanRunCheckpoint = {
				checkpointId: crypto.randomUUID(),
				ordinal: current.checkpoints.length,
				committedAt: new Date().toISOString(),
				completedStepIds: [],
				artifactIds: [...(result.artifactIds ?? [])],
				remainingGoals: [...(result.remainingGoals ?? [])],
				registryRevision: result.registryRevision ?? 0,
				policyDecisionIds: [...(result.policyDecisionIds ?? [])]
			}
			current.checkpoints.push(checkpoint)
			this.#transition(current, 'succeeded')
		} catch (error) {
			const current = this.#required(runId)
			if (current.state === 'cancelled') return
			current.failure = {
				code: 'EXECUTION_FAILED',
				message: error instanceof Error ? error.message : String(error),
				retryable: false
			}
			this.#transition(current, 'failed')
		}
	}

	#required(runId: string): PlanRunRecord {
		const record = this.#records.get(runId)
		if (!record) throw new Error('run not found')
		return record
	}

	#transition(record: PlanRunRecord, state: PlanRunRecord['state']): void {
		assertPlanRunTransition(record.state, state)
		record.state = state
		record.revision += 1
		record.updatedAt = new Date().toISOString()
	}
}

async function executeAlreadySatisfied(
	request: PlanRunStartRequest
): Promise<PlanRunExecutionResult> {
	const facts = new Set(request.ingredients.map((ingredient) => ingredient.predicate))
	const remainingGoals = request.goals.filter((goal) => !facts.has(goal))
	if (remainingGoals.length > 0) {
		throw new Error('no actor executor is registered for the requested goal')
	}
	return { remainingGoals: [] }
}
