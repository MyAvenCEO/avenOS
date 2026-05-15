import type {
	ActorCommand,
	ActorEventInput,
	ActorRecord,
	ContextAppendInput,
	ContextItemRecord,
	ContextQuery,
	EnvelopeInput,
	EnvelopeRecord,
	Persistence
} from '../../persistence-sqlite/src/index'

export interface ActorHandler {
	kind: string

	activate(input: ActorActivation): Promise<ActorDecision>
}

export interface ActorActivation {
	actor: ActorRecord
	envelope: EnvelopeRecord
	context: ActorContext
}

export interface ActorContext {
	now: Date
	signal: AbortSignal
	generateId(): string
	contextSnapshotSeq: number
	makeEnvelope(input: {
		from: string
		to: string
		type: string
		payload: unknown
		runId?: string
		causedBy?: string
		availableAt?: Date
	}): EnvelopeInput
	queryContext(selector: ContextQuery): Promise<ContextItemRecord[]>
}

export interface ActorDecision {
	nextState: unknown
	contextAppends: ContextAppendInput[]
	commands: ActorCommand[]
}

export interface ActorRuntime {
	register(handler: ActorHandler): void
	enqueue(envelope: EnvelopeInput): Promise<void>
	tick(input?: { workerId?: string }): Promise<'processed' | 'idle'>
	runUntilIdle(maxTicks?: number): Promise<number>
	debug: ActorRuntimeDebug
}

export type ActorDebugTrace =
	| {
		kind: 'prompt'
		label: string
		inputSummary: string
		outputSummary?: string
		at: string
	}
	| {
		kind: 'task'
		label: string
		inputSummary: string
		outputSummary?: string
		cwd?: string
		at: string
	}
	| {
		kind: 'shell'
		label: string
		command: string
		cwd?: string
		stdout?: string
		stderr?: string
		exitCode: number
		at: string
	}

export interface ActorRuntimeDebug {
	recordTrace(actorId: string, trace: ActorDebugTrace): void
}

export interface RuntimeLogger {
	debug?(message: string, metadata?: Record<string, unknown>): void
	info?(message: string, metadata?: Record<string, unknown>): void
	warn?(message: string, metadata?: Record<string, unknown>): void
	error?(message: string, metadata?: Record<string, unknown>): void
}

export interface CreateActorRuntimeInput {
	persistence: Persistence
	workerId: string
	leaseMs?: number
	activationTimeoutMs?: number
	activationCleanupMs?: number
	clock?: () => Date
	logger?: RuntimeLogger
}