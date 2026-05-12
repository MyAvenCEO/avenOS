import type { ActorHandler } from '@jaensen/actor-runtime'
import type {
	ActorEventInput,
	EnvelopeRecord,
	Persistence
} from '@jaensen/persistence-sqlite'

export interface SkillDefinition {
	id: string
	path: string
	description: string
	frontmatter: Record<string, unknown>
	body: string
	bodyHash: string
	loadedAt: string
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

export interface BootstrapSkillsInput {
	persistence: Persistence
	skills: SkillDefinition[]
	now: Date
}

export interface SkillSupervisorBrain {
	decide(input: {
		skill: SkillDefinition
		actorState: unknown
		envelope: EnvelopeRecord
	}): Promise<SkillSupervisorDecision>
}

export interface SkillSupervisorDecision {
	state: unknown
	events?: ActorEventInput[]
	actions?: SkillSupervisorAction[]
}

export interface SkillSupervisorState {
	skillId: string
	workers: Record<string, {
		workerId: string
		status: 'active' | 'completed' | 'failed'
		intentId?: string
		callId?: string
		updatedAt: string
	}>
	calls: Record<string, {
		callId: string
		intentId: string
		workerId: string
		status: 'active' | 'completed' | 'failed'
	}>
}

export type SkillSupervisorAction =
	| {
			type: 'reply'
			messageType: string
			payload: unknown
	  }
	| {
			type: 'send'
			to: string
			messageType: string
			payload: unknown
	  }
	| {
			type: 'route_worker'
			workerId: string
			messageType: string
			payload: unknown
	  }
	| {
			type: 'spawn_worker'
			workerId: string
			initialState?: unknown
			messageType: string
			payload: unknown
	  }

export interface SkillWorkerBrain {
	run(input: {
		skill: SkillDefinition
		workerId: string
		actorState: unknown
		envelope: EnvelopeRecord
	}): Promise<SkillWorkerResult>
}

export interface SkillWorkerResult {
	state: unknown
	events?: ActorEventInput[]
	result?: unknown
	completed?: boolean
}

export interface CreateSkillSupervisorHandlerInput {
	registry: SkillRegistry
	brain: SkillSupervisorBrain
}

export interface CreateSkillWorkerHandlerInput {
	registry: SkillRegistry
	brain: SkillWorkerBrain
}

export type { ActorHandler }