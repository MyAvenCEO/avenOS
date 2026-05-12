import { z } from 'zod'
import type { DispatcherDecision, DispatcherState, IntentBrainDecision, IntentState } from '@jaensen/conversation-actors'

import { FlueBrainValidationError } from './errors'

const dispatcherOutputSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('route_existing_intent'),
		intentId: z.string().trim().min(1, 'intentId is required'),
		reason: z.string().trim().min(1, 'reason is required')
	}),
	z.object({
		type: z.literal('create_intent'),
		title: z.string().trim().min(1, 'title is required').max(120, 'title must be at most 120 chars'),
		initialGoal: z.string().trim().min(1, 'initialGoal is required'),
		reason: z.string().trim().min(1, 'reason is required')
	})
])

const eventSchema = z.object({
	eventType: z.string().trim().min(1, 'eventType is required'),
	event: z.unknown()
})

const callSkillActionSchema = z.object({
	type: z.literal('call_skill'),
	skillId: z.string().trim().min(1, 'skillId is required'),
	request: z.string().trim().min(1, 'request is required'),
	payload: z.unknown()
})

const replyUserActionSchema = z.object({
	type: z.literal('reply_user'),
	message: z.string().trim().min(1, 'message is required')
})

const askUserActionSchema = z.object({
	type: z.literal('ask_user'),
	question: z.string().trim().min(1, 'question is required')
})

const completeActionSchema = z.object({
	type: z.literal('complete'),
	summary: z.string().trim().min(1, 'summary is required'),
	message: z.string().trim().min(1, 'message must be non-empty').optional()
})

const failActionSchema = z.object({
	type: z.literal('fail'),
	reason: z.string().trim().min(1, 'reason is required'),
	message: z.string().trim().min(1, 'message must be non-empty').optional()
})

export const flueDispatcherOutputSchema = dispatcherOutputSchema

export const flueIntentOutputSchema = z.object({
	summary: z.string().optional(),
	events: z.array(eventSchema).optional(),
	actions: z.array(z.discriminatedUnion('type', [
		callSkillActionSchema,
		replyUserActionSchema,
		askUserActionSchema,
		completeActionSchema,
		failActionSchema
	])).optional()
})

export function normalizeFlueResponseData<T>(input: T | { data: T }): T {
	if (input && typeof input === 'object' && 'data' in (input as object)) {
		return (input as { data: T }).data
	}

	return input as T
}

export function validateDispatcherDecision(input: unknown, state: DispatcherState): DispatcherDecision {
	const parsed = flueDispatcherOutputSchema.safeParse(input)
	if (!parsed.success) {
		throw new FlueBrainValidationError(
			`Invalid dispatcher decision: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
		)
	}

	if (parsed.data.type === 'route_existing_intent') {
		const intent = state.activeIntents[parsed.data.intentId]
		if (!intent) {
			throw new FlueBrainValidationError('Invalid dispatcher decision: intentId must exist in state.activeIntents')
		}

		if (intent.status === 'completed' || intent.status === 'failed') {
			throw new FlueBrainValidationError('Invalid dispatcher decision: may not route to completed or failed intents')
		}
	}

	return parsed.data
}

export function validateIntentDecision(
	input: unknown,
	context: {
		state: IntentState
		envelope: { toActor: string }
		availableSkillIds: Set<string>
	}
): IntentBrainDecision {
	const parsed = flueIntentOutputSchema.safeParse(input)
	if (!parsed.success) {
		throw new FlueBrainValidationError(
			`Invalid intent decision: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
		)
	}

	for (const action of parsed.data.actions ?? []) {
		if (action.type === 'call_skill') {
			if (!context.availableSkillIds.has(action.skillId)) {
				throw new FlueBrainValidationError('Invalid intent decision: call_skill.skillId must exist in availableSkills')
			}
		}
	}

	return parsed.data
}