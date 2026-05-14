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
	correlationId: string
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
	workerId: string
	skillId?: string
	workerActorId?: string
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
	correlationId?: string
	lastActiveAt?: string
	messages: HumanMessage[]
	questions: HumanQuestion[]
	skillCalls: Record<string, SkillCallView>
	workers: Record<string, WorkerView>
	timeline: TimelineItem[]
	lastSeqByScope: Record<string, number>
}

export interface StreamEventRecord<TPayload = unknown> {
	seq: number
	scope: string
	type: string
	payload: TPayload
	createdAt?: string
	envelopeId?: string | null
}

export interface StreamEventEnvelope<TPayload = unknown> {
	seq: number
	type: string
	payload: TPayload
}

export interface EventListResponse {
	events: Array<{
		seq: number
		scope: string
		actorId: string | null
		envelopeId: string | null
		type: string
		payload: unknown
		createdAt: string
	}>
}

export interface ContextItemDto {
	id: string
	seq: number
	scope:
		| { type: 'run'; correlationId: string }
		| { type: 'intent'; intentId: string }
		| { type: 'call'; callId: string; rootCallId: string; parentCallId?: string }
		| { type: 'actor'; actorId: string }
		| { type: 'global'; name: 'archive' | 'system' }
	kind: string
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

export interface ContextItemsResponse {
	items: ContextItemDto[]
}

export const STREAM_EVENT_TYPES = [
	'intent.created',
	'intent.status_changed',
	'intent.skill_call_started',
	'intent.skill_call_completed',
	'intent.message_to_user',
	'skill.worker_spawned',
	'skill.worker_routed',
	'skill.worker_completed',
	'runtime.envelope.completed',
	'runtime.envelope.queued',
	'runtime.envelope.claimed',
	'runtime.envelope.failed',
	'actor.event',
	'context.appended'
] as const

export type KnownStreamEventType = (typeof STREAM_EVENT_TYPES)[number]

export type DebugActorStatus = 'running' | 'idle' | 'blocked' | 'failed' | 'stopped'

export interface DebugActorInfo {
	id: string
	parentId?: string
	type: string
	name: string
	status: DebugActorStatus
	mailboxDepth: number
	currentTask?: string
	restartCount: number
	lastEventAt: string
}

export interface DebugActorSnapshot {
	actors: DebugActorInfo[]
}

export type DebugActorTrace =
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

export type DebugActorEvent =
	| { type: 'ActorSpawned'; actor: DebugActorInfo }
	| { type: 'ActorStateChanged'; actorId: string; status: DebugActorStatus; at: string; currentTask?: string }
	| { type: 'MessageSent'; id: string; from: string; to: string; messageType: string; at: string }
	| { type: 'ActorStopped'; actorId: string; at: string }
	| { type: 'ActorTraceRecorded'; actorId: string; trace: DebugActorTrace }