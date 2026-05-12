import { z } from 'zod'
import type { DispatcherDecision, DispatcherState, IntentDecision, IntentState } from '@jaensen/conversation-actors'

import { FlueBrainValidationError } from './errors'

const INTENT_STATUS_VALUES = ['active', 'waiting_for_user', 'completed', 'failed'] as const

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

const pendingSkillCallSchema = z.object({
	callId: z.string(),
	skillId: z.string(),
	request: z.string(),
	createdAt: z.string()
})

const intentStateSchema = z.object({
	intentId: z.string().trim().min(1, 'state.intentId is required'),
	title: z.string().trim().min(1, 'state.title is required'),
	goal: z.string().trim().min(1, 'state.goal is required'),
	status: z.enum(INTENT_STATUS_VALUES),
	summary: z.string(),
	pendingSkillCalls: z.record(z.string(), pendingSkillCallSchema)
})

const eventSchema = z.object({
	eventType: z.string().trim().min(1, 'eventType is required'),
	event: z.unknown()
})

const callSkillActionSchema = z.object({
	type: z.literal('call_skill'),
	skillId: z.string().trim().min(1, 'skillId is required'),
	callId: z.string().trim().min(1, 'callId is required'),
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
	state: intentStateSchema,
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
): IntentDecision {
	const parsed = flueIntentOutputSchema.safeParse(input)
	if (!parsed.success) {
		throw new FlueBrainValidationError(
			`Invalid intent decision: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
		)
	}

	if (parsed.data.state.intentId !== context.state.intentId) {
		throw new FlueBrainValidationError('Invalid intent decision: state.intentId must match current actor state/envelope')
	}

	const existingPendingIds = new Set(Object.keys(context.state.pendingSkillCalls))
	const seenCallIds = new Set<string>()

	for (const action of parsed.data.actions ?? []) {
		if (action.type === 'call_skill') {
			if (!context.availableSkillIds.has(action.skillId)) {
				throw new FlueBrainValidationError('Invalid intent decision: call_skill.skillId must exist in availableSkills')
			}

			if (existingPendingIds.has(action.callId) || seenCallIds.has(action.callId)) {
				throw new FlueBrainValidationError('Invalid intent decision: call_skill.callId must be unique among pending calls')
			}

			seenCallIds.add(action.callId)
		}

		if (action.type === 'ask_user' && parsed.data.state.status !== 'waiting_for_user') {
			throw new FlueBrainValidationError('Invalid intent decision: ask_user requires state.status = waiting_for_user')
		}

		if (action.type === 'complete' && parsed.data.state.status !== 'completed') {
			throw new FlueBrainValidationError('Invalid intent decision: complete requires state.status = completed')
		}

		if (action.type === 'fail' && parsed.data.state.status !== 'failed') {
			throw new FlueBrainValidationError('Invalid intent decision: fail requires state.status = failed')
		}
	}

	return parsed.data
}