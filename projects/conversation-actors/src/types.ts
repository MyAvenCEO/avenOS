import type { ActorHandler } from '@jaensen/actor-runtime'
import type {
	ActorEventInput,
	EnvelopeInput,
	EnvelopeRecord
} from '@jaensen/persistence-sqlite'
import type { SkillRegistry } from '@jaensen/skills'

export interface UserAttachment {
	id: string
	name: string
	mimeType: string
	sizeBytes: number
	sha256: string
}

export interface DispatcherState {
	activeIntents: Record<
		string,
		{
			intentId: string
			title: string
			summary: string
			status: 'active' | 'waiting_for_user' | 'completed' | 'failed'
			lastActivityAt: string
		}
	>
}

export interface DispatcherBrain {
	route(input: {
		state: DispatcherState
		envelope: EnvelopeRecord
		userInput: {
			text: string
			attachments: UserAttachment[]
			attachmentScopeId?: string
			intentIdHint?: string
		}
	}): Promise<DispatcherDecision>
}

export type DispatcherDecision =
	| {
			type: 'route_existing_intent'
			intentId: string
			reason: string
	  }
	| {
			type: 'create_intent'
			title: string
			initialGoal: string
			reason: string
	  }

export interface IntentState {
	intentId: string
	title: string
	goal: string
	status: 'active' | 'waiting_for_user' | 'completed' | 'failed'
	summary: string
	pendingSkillCalls: Record<
		string,
		{
			callId: string
			rootCallId: string
			skillId: string
			request: string
			createdAt: string
		}
	>
}

export interface IntentBrain {
	decide(input: {
		state: IntentState
		envelope: EnvelopeRecord
		availableSkills: Array<{
			id: string
			description: string
		}>
		signal?: AbortSignal
	}): Promise<IntentBrainDecision>
}

export interface IntentBrainDecision {
	summary?: string
	events?: ActorEventInput[]
	actions?: IntentAction[]
}

export type IntentAction =
	| {
			type: 'call_skill'
			skillId: string
			request: string
			payload: unknown
	  }
	| {
			type: 'reply_user'
			message: string
	  }
	| {
			type: 'ask_user'
			question: string
	  }
	| {
			type: 'complete'
			summary: string
			message?: string
	  }
	| {
			type: 'fail'
			reason: string
			message?: string
	  }

export interface CreateDispatcherHandlerInput {
	brain: DispatcherBrain
	createIntentId?: () => string
}

export interface CreateIntentHandlerInput {
	brain: IntentBrain
	skillRegistry: SkillRegistry
}

export interface IntentActionEnvelopeInput {
	state: IntentState
	actions: IntentAction[]
	envelope: EnvelopeRecord
	availableSkills: SkillRegistry
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => EnvelopeInput
}

export type { ActorHandler, ActorEventInput, EnvelopeInput, EnvelopeRecord, SkillRegistry }