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
	runId: string
	causedBy?: string | null
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
	runId: string
	causedBy: string | null
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

export type EventVisibility = 'chat' | 'worklog' | 'debug'

export interface EventInput {
	type: string
	visibility: EventVisibility
	runId?: string | null
	intentId?: string | null
	actorId?: string | null
	envelopeId?: string | null
	callId?: string | null
	parentSeq?: number | null
	payload: unknown
	createdAt?: Date | string
}

export interface EventRecord {
	seq: number
	type: string
	visibility: EventVisibility
	runId: string | null
	intentId: string | null
	actorId: string | null
	envelopeId: string | null
	callId: string | null
	parentSeq: number | null
	payload: unknown
	createdAt: string
}

export type ContextVisibility = 'chat' | 'worklog' | 'debug'

export type ContextAppendInput = {
	kind: string
	visibility?: ContextVisibility
	runId?: string | null
	intentId?: string | null
	actorId?: string | null
	envelopeId?: string | null
	callId?: string | null
	key?: string | null
	summary?: string | null
	body?: unknown
	artifactUri?: string | null
	createdAt?: Date | string
}

export type ContextItemRecord = {
	seq: number
	kind: string
	visibility: ContextVisibility
	runId: string | null
	intentId: string | null
	actorId: string | null
	envelopeId: string | null
	callId: string | null
	key: string | null
	summary: string | null
	body: unknown
	artifactUri: string | null
	createdAt: string
}

export type ContextQuery = {
	afterSeq?: number
	limit?: number
	visibility?: ContextVisibility | ContextVisibility[]
	runId?: string
	intentId?: string
	actorId?: string
	callId?: string
	kind?: string | string[]
}

export type ActorCommand =
	| { type: 'send_envelope'; envelope: EnvelopeInput }
	| { type: 'schedule_envelope'; envelope: EnvelopeInput; availableAt: string }
	| { type: 'emit_event'; event: ActorEventInput }

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

export interface ActorHierarchyRecord {
	actorId: string
	parentActorId: string | null
	kind: string
	name: string
	depth: number
	isCurrent: boolean
	firstSeenAt: string | null
	lastSeenAt: string | null
}

export interface ActorLogRecord extends EventRecord {
	logView: 'chat' | 'deep-dive'
}

export interface CommunicationTreeRecord {
	nodeId: string
	parentNodeId: string | null
	nodeKind: 'envelope' | 'log'
	depth: number
	runId: string | null
	envelopeId: string | null
	actorId: string | null
	fromActor: string | null
	toActor: string | null
	eventType: string
	payload: unknown
	createdAt: string
}

export interface CommunicationTreeSummary {
	rootCount: number
	envelopeCount: number
	logCount: number
	actorCount: number
	actorIoCount: number
	errorCount: number
	startedAt: string | null
	endedAt: string | null
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
		nextActorState: unknown
		contextAppends: ContextAppendInput[]
		commands: ActorCommand[]
		now: Date
	}): Promise<void>

	appendContext(input: ContextAppendInput): Promise<number>

	listContextItems(input: {
		selector: ContextQuery
		snapshotSeq?: number
	}): Promise<ContextItemRecord[]>

	getContextSnapshotSeq(): Promise<number>

	failActivation(input: {
		workerId: string
		envelopeId: string
		error: string
		nonRetryable?: boolean
		retryAt?: Date
		now: Date
	}): Promise<void>

	releaseExpiredLocks(now: Date): Promise<number>

	replaceSkills(skills: SkillRecordInput[], now: Date): Promise<void>

	listSkills(): Promise<SkillRecord[]>

	appendEvents(events: EventInput[]): Promise<number[]>

	listEvents(input: {
		after?: number
		limit?: number
		visibility?: EventVisibility | EventVisibility[]
		runId?: string
		intentId?: string
		actorId?: string
		callId?: string
	}): Promise<EventRecord[]>

	listActorHierarchy(input: { rootActorId: string; observed?: boolean; includeRoot?: boolean }): Promise<ActorHierarchyRecord[]>

	listActorBranchLogs(input: {
		rootActorId: string
		view?: 'chat' | 'deep-dive'
		after?: number
		limit?: number
	}): Promise<ActorLogRecord[]>

	listCommunicationTree(input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeRecord[]>

	summarizeCommunicationTree(input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeSummary>
}