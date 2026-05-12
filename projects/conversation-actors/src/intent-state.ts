import { ConversationActorsValidationError } from './errors'
import type { IntentState } from './types'

export function createInitialIntentState(input: {
	intentId: string
	title: string
	goal: string
}): IntentState {
	return {
		intentId: input.intentId,
		title: input.title,
		goal: input.goal,
		status: 'active',
		summary: input.goal,
		pendingSkillCalls: {}
	}
}

export function assertIntentState(state: unknown, actorId?: string): IntentState {
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		throw new ConversationActorsValidationError('Intent state must be an object')
	}

	const candidate = state as Partial<IntentState>
	if (!candidate.intentId || !candidate.title || !candidate.goal || !candidate.status) {
		throw new ConversationActorsValidationError('Intent state is missing required fields')
	}

	if (actorId) {
		const parsedIntentId = parseIntentActorId(actorId)
		if (!parsedIntentId) {
			throw new ConversationActorsValidationError(`Invalid intent actor id: ${actorId}`)
		}

		if (parsedIntentId !== candidate.intentId) {
			throw new ConversationActorsValidationError(
				`Intent state intentId ${candidate.intentId} does not match actor ${actorId}`
			)
		}
	}

	return {
		intentId: candidate.intentId,
		title: candidate.title,
		goal: candidate.goal,
		status: candidate.status,
		summary: candidate.summary ?? '',
		pendingSkillCalls: candidate.pendingSkillCalls ?? {}
	}
}

export function parseIntentActorId(actorId: string): string | null {
	return actorId.startsWith('intent/') ? actorId.slice('intent/'.length) || null : null
}