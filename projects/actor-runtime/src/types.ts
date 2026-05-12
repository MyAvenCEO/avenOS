import type {
	ActorEventInput,
	ActorRecord,
	EnvelopeInput,
	EnvelopeRecord,
	Persistence
} from '../../persistence-sqlite/src/index'

export interface ActorHandler {
	kind: string

	activate(input: ActorActivation): Promise<ActorActivationResult>
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
	makeEnvelope(input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}): EnvelopeInput
}

export interface ActorActivationResult {
	state: unknown
	events?: ActorEventInput[]
	outgoing?: EnvelopeInput[]
}

export interface ActorRuntime {
	register(handler: ActorHandler): void
	enqueue(envelope: EnvelopeInput): Promise<void>
	tick(): Promise<'processed' | 'idle'>
	runUntilIdle(maxTicks?: number): Promise<number>
	debug: ActorRuntimeDebug
}

export type ActorStatus = 'running' | 'idle' | 'blocked' | 'failed' | 'stopped'

export interface ActorInfo {
	id: string
	parentId?: string
	type: string
	name: string
	status: ActorStatus
	mailboxDepth: number
	currentTask?: string
	restartCount: number
	lastEventAt: string
}

export interface ActorSnapshot {
	actors: ActorInfo[]
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

export type ActorEvent =
	| { type: 'ActorSpawned'; actor: ActorInfo }
	| { type: 'ActorStateChanged'; actorId: string; status: ActorStatus; at: string; currentTask?: string }
	| { type: 'MessageSent'; id: string; from: string; to: string; messageType: string; at: string }
	| { type: 'ActorStopped'; actorId: string; at: string }
	| { type: 'ActorTraceRecorded'; actorId: string; trace: ActorDebugTrace }

export interface DebugEventCursor {
	seq: number
	event: ActorEvent
}

export type DebugEventListener = (event: DebugEventCursor) => void

export interface ActorRuntimeDebug {
	getSnapshot(): ActorSnapshot
	listEvents(after?: number): DebugEventCursor[]
	subscribe(listener: DebugEventListener): () => void
	seedActor(actor: Pick<ActorInfo, 'id' | 'type' | 'name'> & Partial<ActorInfo>): ActorInfo
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