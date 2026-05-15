export type IntentStatus = 'active' | 'waiting_for_user' | 'completed' | 'failed'

export interface PostMessageAttachmentInput {
	id?: string
	name?: string
	contentType?: string
	base64?: string
	path?: string
	mimeType?: string
	sizeBytes?: number
	sha256?: string
}

export interface PostMessageInput {
	text: string
	intentIdHint?: string
	attachments?: PostMessageAttachmentInput[]
}

export interface PostMessageResult {
	envelopeId: string
	runId: string
}

export interface IntentSummaryDto {
	id: string
	title: string | null
	goal: string | null
	status: string | null
	summary: string | null
	pendingSkillCalls: Record<string, unknown>
	version: number
	createdAt: string
	updatedAt: string
	state: unknown
}

export interface IntentDetailDto extends IntentSummaryDto {}

export type ActorDetailTab = 'log' | 'messages' | 'context' | 'state' | 'config'

export interface HumanMessage {
	id: string
	intentId: string
	role: 'user' | 'assistant'
	text: string
	createdAt?: string
	envelopeId?: string | null
	seq?: number
}

export interface HumanQuestion {
	id: string
	intentId: string
	question: string
	createdAt?: string
	envelopeId?: string | null
	resolved?: boolean
	seq?: number
}

export interface SkillCallView {
	callId: string
	skillId: string
	request: string
	status: 'pending' | 'completed' | 'failed' | 'needs_clarification'
	startedAt?: string
	updatedAt?: string
	resultSummary?: string
	metadata?: Record<string, unknown>
}

export interface WorkerView {
	workerActorId: string
	workerName: string
	skillId?: string
	status: 'spawned' | 'routed' | 'completed'
	startedAt?: string
	updatedAt?: string
	metadata?: Record<string, unknown>
}

export interface TimelineItem {
	id: string
	seq: number
	type: string
	title: string
	detail?: string
	at?: string
	actorId?: string
	fromActor?: string
	toActor?: string
	envelopeId?: string | null
	kind:
		| 'human'
		| 'question'
		| 'intent'
		| 'skill_call'
		| 'worker'
		| 'debug'
}

export interface IntentView {
	intentId: string
	title: string
	status: IntentStatus
	summary: string
	createdAt?: string
	updatedAt?: string
	runId?: string
	lastActiveAt?: string
	messages: HumanMessage[]
	questions: HumanQuestion[]
	skillCalls: Record<string, SkillCallView>
	workers: Record<string, WorkerView>
	timeline: TimelineItem[]
	lastSeqByScope: Record<string, number>
}

export interface EventRecord<TPayload = unknown> {
	seq: number
	type: string
	visibility: 'chat' | 'worklog' | 'debug'
	runId: string | null
	intentId: string | null
	actorId: string | null
	payload: TPayload
	createdAt: string
	envelopeId: string | null
	callId: string | null
	parentSeq: number | null
}

export interface EventListResponse {
	events: Array<{
		seq: number
		visibility?: 'chat' | 'worklog' | 'debug'
		runId?: string | null
		intentId?: string | null
		actorId: string | null
		envelopeId: string | null
		callId?: string | null
		parentSeq?: number | null
		type: string
		payload: unknown
		createdAt: string
	}>
}

export interface IntentActorNode {
	actorId: string
	uiParentActorId: string | null
	pathParentActorId: string | null
	kind: 'intent' | 'skill' | 'worker' | 'system' | 'human' | 'group' | 'unknown'
	label: string
	subtitle?: string
	isAggregateRoot: boolean
	isVirtual: boolean
	status?: 'active' | 'idle' | 'completed' | 'failed'
	eventCount: number
	envelopeCount: number
	contextCount: number
	firstSeenAt: string | null
	lastSeenAt: string | null
}

export interface IntentActorsResponse {
	actors: IntentActorNode[]
}

export interface EnvelopeDto {
	id: string
	fromActor: string
	toActor: string
	type: string
	runId: string
	causedBy: string | null
	status: string
	payload: unknown
	createdAt: string
	updatedAt: string
}

export interface EnvelopeListResponse {
	envelopes: EnvelopeDto[]
}

export interface ActorDetailDto {
	actorId: string
	kind: string
	status: string | null
	state: unknown
	version: number | null
	createdAt: string | null
	updatedAt: string | null
	config?: unknown
}

export interface ContextItemDto {
	seq: number
	kind: string
	visibility: 'chat' | 'worklog' | 'debug'
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

export interface ContextItemsResponse {
	items: ContextItemDto[]
}
