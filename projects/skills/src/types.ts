import type { ActorHandler } from '@jaensen/actor-runtime'
import type { ActorEventInput, EnvelopeRecord, Persistence } from '@jaensen/persistence-sqlite'

export interface SkillDefinition {
	id: string
	path: string
	description: string
	directActors: string[]
	frontmatter: Record<string, unknown>
	body: string
	bodyHash: string
	loadedAt: string
}

export interface SkillCallAction {
	type: 'call_skill'
	to: string
	callId: string
	request: string
	payload: unknown
}

export interface SkillRegistry {
	list(): SkillDefinition[]
	get(id: string): SkillDefinition | null
	require(id: string): SkillDefinition
}

export interface LoadSkillsInput {
	rootDir: string
	now?: Date
}

export interface SharedSkillResourceConfig {
	uploadRoot?: string
}

export interface BootstrapSkillsInput {
	persistence: Persistence
	skills: SkillDefinition[]
	now: Date
}

export interface SkillSupervisorState {
	skillId: string
	workers: Record<string, {
		workerActorId: string
		workerName: string
		status: 'active' | 'completed' | 'failed'
		intentId?: string
		callId?: string
		updatedAt: string
	}>
	calls: Record<string, {
		callId: string
		workerActorId: string
		status: 'active' | 'completed' | 'failed'
		replyTo: string
		intentId?: string
		parentCallId?: string
	}>
}

export interface SkillWorkerBrain {
	run(input: {
		skill: SkillDefinition
		workerActorId: string
		workerName: string
		actorState: unknown
		envelope: EnvelopeRecord
		signal?: AbortSignal
	}): Promise<SkillWorkerResult>
}

export interface SkillWorkerResult {
	state: unknown
	events?: ActorEventInput[]
	result?: unknown
	completed?: boolean
	actions?: SkillCallAction[]
	contextAppends?: import('@jaensen/persistence-sqlite').ContextAppendInput[]
}

export interface CreateSkillSupervisorHandlerInput {
	registry: SkillRegistry
}

export interface CreateSkillWorkerHandlerInput {
	registry: SkillRegistry
	brain: SkillWorkerBrain
}

export type { ActorHandler }