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

export type ContextScope =
	| { type: 'run'; correlationId: string }
	| { type: 'intent'; intentId: string }
	| { type: 'call'; callId: string; rootCallId: string; parentCallId?: string }
	| { type: 'actor'; actorId: string }
	| { type: 'global'; name: 'archive' | 'system' }

export type ContextKind =
	| 'user_input'
	| 'fact'
	| 'hypothesis'
	| 'decision'
	| 'handoff'
	| 'tool_result'
	| 'artifact_ref'
	| 'error'
	| 'observation'
	| 'constraint'

export interface ContextAppendInput {
	scope: ContextScope
	kind: ContextKind
	key?: string
	schema?: string
	tags: string[]
	body?: unknown
	artifactId?: string
	summary?: string
	producedByCommandId?: string
	producedByToolCallId?: string
	sourceContextItemIds: string[]
	confidence?: number
	supersedesItemId?: string
	redactsItemId?: string
}

export interface ContextItemRecord {
	id: string
	seq: number
	scope: ContextScope
	kind: ContextKind
	key?: string
	schema?: string
	tags: string[]
	body?: unknown
	artifactId?: string
	summary?: string
	correlationId: string
	intentId?: string
	actorId: string
	callId?: string
	parentCallId?: string
	rootCallId?: string
	producedByActorId: string
	producedByEnvelopeId: string
	producedByCommandId?: string
	producedByToolCallId?: string
	sourceContextItemIds: string[]
	confidence?: number
	hash: string
	createdAt: string
	supersedesItemId?: string
	redactsItemId?: string
}

export interface ContextSelector {
	scopes?: ContextScope[]
	kinds?: ContextKind[]
	keys?: string[]
	tags?: string[]
	schemas?: string[]
	producedByActorIds?: string[]
	afterSeq?: number
	limit?: number
	includeRedacted?: boolean
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

export interface StreamEventInput {
	readonly id: string
	readonly scope: string
	readonly actorId?: string | null
	readonly envelopeId?: string | null
	readonly type: string
	readonly payload: unknown
	readonly createdAt: Date | string
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

export interface ActorLogRecord extends StreamEventRecord {
	logView: 'chat' | 'deep-dive'
}

export interface CommunicationTreeRecord {
	nodeId: string
	parentNodeId: string | null
	nodeKind: 'envelope' | 'log'
	depth: number
	correlationId: string | null
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

	listContextItems(input: {
		selector: ContextSelector
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

	appendStreamEvents(events: StreamEventInput[]): Promise<void>

	listStreamEvents(input: { scope: string; after?: number; limit?: number }): Promise<StreamEventRecord[]>

	listActorHierarchy(input: { rootActorId: string; observed?: boolean; includeRoot?: boolean }): Promise<ActorHierarchyRecord[]>

	listActorBranchLogs(input: {
		rootActorId: string
		view?: 'chat' | 'deep-dive'
		after?: number
		limit?: number
	}): Promise<ActorLogRecord[]>

	listCommunicationTree(input: {
		correlationId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeRecord[]>

	summarizeCommunicationTree(input: {
		correlationId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeSummary>
}