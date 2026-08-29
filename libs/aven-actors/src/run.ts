import type { Predicate } from './actor'
import type { ActorAccessContext, ActorPrincipal } from './authorization'
import { AVEN_RUNTIME_AUTHORITY, type ProtocolId, resourceId, type SkillId } from './ids'
import type { Ingredient } from './planner'
import type { ExecutionEnvironment } from './registry'

/** Wire contract shared by desktop and server plan runners. */
export const ACTOR_RUN_PROTOCOL = resourceId({
	authority: AVEN_RUNTIME_AUTHORITY,
	kind: 'protocol',
	namespace: 'actors',
	name: 'plan-runner',
	version: '1'
})

export type PlanRunState =
	| 'accepted'
	| 'planning'
	| 'running'
	| 'waiting_for_input'
	| 'succeeded'
	| 'failed'
	| 'cancelled'

/** Caller-controlled command. It contains no asserted identity or grants. */
export interface PlanRunStartCommand {
	protocol: ProtocolId
	requestId: string
	idempotencyKey: string
	requestedAt: string
	/** Application-owned skill identity, normally under `ceo.aven`. */
	skillRef: SkillId
	executionEnvironment: ExecutionEnvironment
	ingredients: Ingredient[]
	goals: Predicate[]
	parameters: Record<string, unknown>
}

/** Security context stamped by a trusted host boundary after authentication. */
export interface PlanRunSecurityContext {
	principal: ActorPrincipal
	access: ActorAccessContext
	establishedBy: string
	authorizedAt: string
}

/** Internal command admitted for planning; clients cannot supply `security`. */
export interface PlanRunStartRequest extends PlanRunStartCommand {
	security: PlanRunSecurityContext
}

export interface PlanRunHandle {
	runId: string
	revision: number
	state: PlanRunState
	executionEnvironment: ExecutionEnvironment
}

export interface PlanRunCheckpoint {
	checkpointId: string
	ordinal: number
	committedAt: string
	completedStepIds: string[]
	artifactIds: string[]
	remainingGoals: Predicate[]
	registryRevision: number
	policyDecisionIds: string[]
}

export interface PlanRunContinuation {
	continuationId: string
	kind: 'input' | 'secret' | 'approval' | 'assurance'
	schema: string
	subject?: string
	prompt: string
	/** Secrets are never persisted. Only this request metadata is durable. */
	persistence: 'metadata-only' | 'artifact'
	state: 'open' | 'postponed' | 'resolved' | 'cancelled'
}

export interface PlanRunRecord extends PlanRunHandle {
	protocol: ProtocolId
	requestId: string
	idempotencyKey: string
	requestedAt: string
	skillRef: SkillId
	security: PlanRunSecurityContext
	createdAt: string
	updatedAt: string
	ingredients: Ingredient[]
	goals: Predicate[]
	parameters: Record<string, unknown>
	checkpoints: PlanRunCheckpoint[]
	continuations: PlanRunContinuation[]
	failure?: { code: string; message: string; retryable: boolean }
}

/** Portable result returned by either a local or server execution host. */
export interface PlanRunExecutionResult {
	artifactIds?: string[]
	completedStepIds?: string[]
	remainingGoals?: Predicate[]
	registryRevision?: number
	policyDecisionIds?: string[]
	/** A durable request for information which the executor cannot obtain itself. */
	continuation?: PlanRunContinuation
}

export interface PlanRunExecutionContext {
	/** Present only for this invocation. The runner never adds it to the run record. */
	submission?: Extract<PlanRunContinuationSubmission, { action: 'submit' }>
}

/** Shared executor contract composed by local and server runner hosts. */
export type PlanRunExecutor = (
	request: PlanRunStartRequest,
	context?: PlanRunExecutionContext
) => Promise<PlanRunExecutionResult>

/**
 * A continuation value is transport data, not necessarily durable data. A
 * runner MUST discard `secret` values after the admitted attempt and MUST NOT
 * put them in PlanRunRecord, artifacts, logs, or production-run parameters.
 */
export type PlanRunContinuationSubmission =
	| {
			requestId: string
			continuationId: string
			action: 'postpone'
	  }
	| {
			requestId: string
			continuationId: string
			action: 'submit'
			kind: PlanRunContinuation['kind']
			value: unknown
	  }

export interface PlanRunner {
	start(request: PlanRunStartRequest): Promise<PlanRunHandle>
	status(runId: string): Promise<PlanRunRecord | null>
	resume(runId: string, submission: PlanRunContinuationSubmission): Promise<PlanRunHandle>
	cancel(runId: string, requestId: string): Promise<PlanRunHandle>
}

/** Authenticated facade used by an app; the server stamps security context. */
export interface PlanRunnerClient {
	start(command: PlanRunStartCommand): Promise<PlanRunHandle>
	status(runId: string): Promise<PlanRunRecord | null>
	resume(runId: string, submission: PlanRunContinuationSubmission): Promise<PlanRunHandle>
	cancel(runId: string, requestId: string): Promise<PlanRunHandle>
}

const TRANSITIONS: Record<PlanRunState, ReadonlySet<PlanRunState>> = {
	accepted: new Set(['planning', 'cancelled', 'failed']),
	planning: new Set(['running', 'waiting_for_input', 'cancelled', 'failed']),
	running: new Set(['planning', 'waiting_for_input', 'succeeded', 'cancelled', 'failed']),
	waiting_for_input: new Set(['planning', 'running', 'cancelled', 'failed']),
	succeeded: new Set(),
	failed: new Set(['planning', 'cancelled']),
	cancelled: new Set()
}

export function assertPlanRunTransition(from: PlanRunState, to: PlanRunState): void {
	if (from === to) return
	if (!TRANSITIONS[from].has(to)) throw new Error(`invalid plan run transition ${from} -> ${to}`)
}

/**
 * Fail closed at a process boundary. JSON.stringify alone silently drops
 * functions and undefined values, which can otherwise make a local-only
 * implementation appear portable until it is moved to a server.
 */
export function assertPortableRunValue(value: unknown, path = '$', seen = new Set<object>()): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`${path} is not a finite JSON number`)
		return
	}
	if (typeof value !== 'object') throw new Error(`${path} is not portable JSON`)
	if (seen.has(value)) throw new Error(`${path} contains a cycle`)
	seen.add(value)
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			assertPortableRunValue(item, `${path}[${index}]`, seen)
		})
		seen.delete(value)
		return
	}
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`${path} must be a plain object`)
	}
	for (const [key, item] of Object.entries(value)) {
		assertPortableRunValue(item, `${path}.${key}`, seen)
	}
	seen.delete(value)
}

/** Simulates the exact JSON boundary used by a future remote runner. */
export function portableRunClone<Value>(value: Value): Value {
	assertPortableRunValue(value)
	return JSON.parse(JSON.stringify(value)) as Value
}
