export type ActorStatus = 'active' | 'stopped' | 'failed'

export type EnvelopeStatus = 'queued' | 'processing' | 'done' | 'failed' | 'dead'

export interface ActorRecord {
	id: string
	kind: string
	status: ActorStatus
	state: unknown
	version: number
	createdAt: string
	updatedAt: string
}

export interface EnvelopeInput {
	id: string
	fromActor: string
	toActor: string
	type: string
	correlationId: string
	causationId?: string | null
	payload: unknown
	availableAt?: Date | string
	maxAttempts?: number
	createdAt?: Date | string
}

export interface EnvelopeRecord {
	id: string
	fromActor: string
	toActor: string
	type: string
	correlationId: string
	causationId: string | null
	payload: unknown
	status: EnvelopeStatus
	availableAt: string
	attempts: number
	maxAttempts: number
	lockedBy: string | null
	lockedUntil: string | null
	lastError: string | null
	createdAt: string
	updatedAt: string
}

export interface ClaimedEnvelope {
	envelope: EnvelopeRecord
	actor: ActorRecord
}

export interface ActorEventInput {
	id?: string
	actorId?: string
	envelopeId?: string | null
	eventType: string
	event: unknown
	createdAt?: Date | string
}

export interface SkillRecordInput {
	id: string
	path: string
	frontmatter: unknown
	body: string
	bodyHash: string
}

export interface SkillRecord {
	id: string
	path: string
	frontmatter: unknown
	body: string
	bodyHash: string
	loadedAt: string
}

export interface StreamEventRecord {
	seq: number
	id: string
	scope: string
	actorId: string | null
	envelopeId: string | null
	type: string
	payload: unknown
	createdAt: string
}

export interface Persistence {
	migrate(): Promise<void>

	upsertActor(input: {
		id: string
		kind: string
		status?: ActorStatus
		state?: unknown
	}): Promise<void>

	ensureActorExists(input: {
		id: string
		kind: string
		status?: ActorStatus
		state?: unknown
	}): Promise<void>

	getActor(id: string): Promise<ActorRecord | null>

	enqueue(envelope: EnvelopeInput): Promise<void>

	claimNext(input: {
		workerId: string
		leaseMs: number
		now: Date
	}): Promise<ClaimedEnvelope | null>

	commitActivation(input: {
		workerId: string
		envelopeId: string
		actorId: string
		expectedActorVersion: number
		newActorState: unknown
		events: ActorEventInput[]
		outgoing: EnvelopeInput[]
		now: Date
	}): Promise<void>

	failActivation(input: {
		workerId: string
		envelopeId: string
		error: string
		retryAt?: Date
		now: Date
	}): Promise<void>

	releaseExpiredLocks(now: Date): Promise<number>

	replaceSkills(skills: SkillRecordInput[], now: Date): Promise<void>

	listSkills(): Promise<SkillRecord[]>
}