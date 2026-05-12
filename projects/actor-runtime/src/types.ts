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
	clock?: () => Date
	logger?: RuntimeLogger
}