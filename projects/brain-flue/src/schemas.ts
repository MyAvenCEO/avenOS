import { z } from 'zod'

import { parseSkillActorId } from '@jaensen/persistence-sqlite'
import { normalizeWorkerResult } from '@jaensen/skills'

import { FlueBrainValidationError } from './errors'
import { isSlugSafe } from './session-names'

const eventSchema = z.object({
	eventType: z.string().min(1, 'eventType is required'),
	event: z.unknown()
})

const messageTypeSchema = z.string().trim().min(1, 'messageType must be non-empty')

const replyActionSchema = z.object({
	type: z.literal('reply'),
	messageType: messageTypeSchema,
	payload: z.unknown()
})

const sendActionSchema = z.object({
	type: z.literal('send'),
	to: z.string().trim().min(1, 'to is required'),
	messageType: messageTypeSchema,
	payload: z.unknown()
})

const skillActorSchema = z.string().trim().refine((value) => parseSkillActorId(value) !== null, 'to must target aven/skills/<skill-id>')

const callSkillActionSchema = z.object({
	type: z.literal('call_skill'),
	to: skillActorSchema,
	callId: z.string().trim().min(1, 'callId is required'),
	request: z.string().trim().min(1, 'request is required'),
	payload: z.unknown()
})

const routeWorkerActionSchema = z.object({
	type: z.literal('route_worker'),
	workerActorId: z.string().min(1, 'workerActorId is required'),
	workerName: z.string().refine((value) => isSlugSafe(value), 'workerName must be slug-safe'),
	messageType: messageTypeSchema,
	payload: z.unknown()
})

const spawnWorkerActionSchema = z.object({
	type: z.literal('spawn_worker'),
	workerActorId: z.string().min(1, 'workerActorId is required'),
	workerName: z.string().refine((value) => isSlugSafe(value), 'workerName must be slug-safe'),
	initialState: z.unknown().optional(),
	messageType: messageTypeSchema,
	payload: z.unknown()
})

export const skillSupervisorDecisionSchema = z.object({
	state: z.unknown().default({}),
	events: z.array(eventSchema).optional(),
	actions: z.array(z.discriminatedUnion('type', [replyActionSchema, sendActionSchema, routeWorkerActionSchema, spawnWorkerActionSchema, callSkillActionSchema])).optional()
})

export const skillWorkerResultSchema = z.object({
	state: z.unknown().default({}),
	events: z.array(eventSchema).optional(),
	result: z.unknown().optional(),
	completed: z.boolean().optional(),
	actions: z.array(callSkillActionSchema).optional()
})

export function validateSupervisorDecision(input: unknown, envelopeFromActor: string) {
	const parsed = skillSupervisorDecisionSchema.safeParse(input)
	if (!parsed.success) {
		throw new FlueBrainValidationError(`Invalid supervisor decision: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
	}

	for (const action of parsed.data.actions ?? []) {
		if (action.type === 'send' && action.to === 'human') {
			throw new FlueBrainValidationError('Invalid supervisor decision: supervisor may not send to human')
		}

		if (action.type === 'reply' && envelopeFromActor === 'human') {
			throw new FlueBrainValidationError('Invalid supervisor decision: supervisor may not send to human')
		}
	}

	return parsed.data
}

export function validateWorkerResult(input: unknown) {
	const parsed = skillWorkerResultSchema.safeParse(input)
	if (!parsed.success) {
		throw new FlueBrainValidationError(`Invalid worker result: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
	}

	const normalized = normalizeWorkerResult(parsed.data)
	const stateChanged = normalized.state !== undefined && (
		typeof normalized.state !== 'object' ||
		normalized.state === null ||
		Array.isArray(normalized.state) ||
		Object.keys(normalized.state as Record<string, unknown>).length > 0
	)
	const hasChildActions = (normalized.actions?.length ?? 0) > 0
	const hasResult = normalized.completed

	if (!hasChildActions && !hasResult && !stateChanged) {
		throw new FlueBrainValidationError('Invalid worker result: must include result, actions, or a useful state change')
	}

	return normalized
}