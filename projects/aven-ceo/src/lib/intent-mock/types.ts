/** Mock-only domain for /me intent orchestrator (no Jazz / API). */

export type AgentStatus = 'idle' | 'running' | 'blocked_hitl' | 'done'

/** Sub-views for the selected actor (see `actor-context-tabs.ts` — configurable per actor tier). */
export type ActorContextTab = 'overview' | 'config' | 'context'

export interface ToolCallStep {
	id: string
	agentId: string
	tool: string
	inputSummary: string
	outputSummary?: string
	status: 'pending' | 'ok' | 'error'
}

export interface ActivityItem {
	id: string
	at: string
	kind: 'orchestrator' | 'sub_agent' | 'tool' | 'delegation' | 'hitl' | 'human'
	title: string
	detail?: string
	agentId?: string
}

export interface ActorDetailItem {
	id: string
	at: string
	kind: 'status' | 'message' | 'prompt' | 'task' | 'shell'
	title: string
	detail?: string
	meta?: string
}

export interface SubAgent {
	id: string
	name: string
	role: string
	status: AgentStatus
	parentOrchestratorId: string
	blockedReason?: string
	/** Catalog id — UI matches {@link IntentSkillBinding.skillId} / name lines everywhere. */
	skillId?: string
}

export type HitlTodoType = 'text_reply' | 'choice' | 'approve_reject'

export interface HitlTodoBase {
	id: string
	intentId: string
	title: string
	status: 'open' | 'done'
	createdAt: string
}

export interface HitlTextReply extends HitlTodoBase {
	type: 'text_reply'
	placeholder: string
	question: string
}

export interface HitlChoice extends HitlTodoBase {
	type: 'choice'
	question: string
	options: { id: string; label: string }[]
}

export interface HitlApproveReject extends HitlTodoBase {
	type: 'approve_reject'
	summary: string
}

export type HitlTodo = HitlTextReply | HitlChoice | HitlApproveReject

export interface IntentConfig {
	routingMode: 'select' | 'spawn'
	workerClassLabel: string
	notes: string
}

export interface IntentSkillBinding {
	skillId: string
	name: string
	bound: boolean
}

export interface IntentOrchestrator {
	id: string
	title: string
	/** Short line for the intent list (CEO-facing). */
	summary: string
	done: boolean
	isActivelyWorkedOn?: boolean
	lastActiveAt?: string
	orchestratorLabel: string
	subAgents: SubAgent[]
	activity: ActivityItem[]
	actorDetails?: Record<string, ActorDetailItem[]>
	toolCalls: ToolCallStep[]
	hitlTodos: HitlTodo[]
	config: IntentConfig
	skills: IntentSkillBinding[]
}
