import type { EnvelopeInput, EnvelopeRecord } from '@jaensen/persistence-sqlite'

import { UnknownSkillError } from './errors'
import type { IntentAction, IntentState, SkillRegistry } from './types'

export interface ResolvedIntentAction {
	type: 'call_skill' | 'reply_user' | 'ask_user' | 'complete' | 'fail'
	skillId?: string
	callId?: string
	request?: string
	payload?: unknown
	message?: string
	question?: string
	summary?: string
	reason?: string
}

export function resolveIntentActions(input: {
	state: IntentState
	actions: IntentAction[]
	generateId: () => string
	now?: Date
}): {
	state: IntentState
	actions: ResolvedIntentAction[]
} {
	const resolvedActions: ResolvedIntentAction[] = input.actions.map((action) =>
		action.type === 'call_skill'
			? {
				type: 'call_skill',
				skillId: action.skillId,
				callId: input.generateId(),
				request: action.request,
				payload: action.payload
			}
			: action
	)

	return {
		state: applyIntentActionStateEffects({
			state: input.state,
			actions: resolvedActions,
			now: input.now
		}),
		actions: resolvedActions
	}
}

export function applyIntentActionStateEffects(input: {
	state: IntentState
	actions: Array<IntentAction | ResolvedIntentAction>
	now?: Date
}): IntentState {
	let nextState: IntentState = {
		...input.state,
		pendingSkillCalls: { ...input.state.pendingSkillCalls }
	}
	const nowIso = (input.now ?? new Date()).toISOString()

	for (const action of input.actions) {
		switch (action.type) {
			case 'ask_user':
				nextState = { ...nextState, status: 'waiting_for_user' }
				break
			case 'complete':
				nextState = { ...nextState, status: 'completed', summary: action.summary }
				break
			case 'fail':
				nextState = { ...nextState, status: 'failed', summary: action.reason }
				break
			case 'call_skill':
				nextState = {
					...nextState,
					pendingSkillCalls: {
						...nextState.pendingSkillCalls,
						[action.callId]: {
							callId: action.callId,
							skillId: action.skillId,
							request: action.request,
							createdAt: nowIso
						}
					}
				}
				break
			default:
				break
		}
	}

	return nextState
}

export function mapIntentActionsToEnvelopes(input: {
	fromActor: string
	state: IntentState
	actions: Array<IntentAction | ResolvedIntentAction>
	envelope: EnvelopeRecord
	skillRegistry: SkillRegistry
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => EnvelopeInput
}): EnvelopeInput[] {
	return input.actions.flatMap((action) => mapIntentActionToEnvelopes({ ...input, action }))
}

function mapIntentActionToEnvelopes(input: {
	fromActor: string
	state: IntentState
	action: IntentAction
	envelope: EnvelopeRecord
	skillRegistry: SkillRegistry
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => EnvelopeInput
}): EnvelopeInput[] {
	const base = {
		from: input.fromActor,
		correlationId: input.envelope.correlationId,
		causationId: input.envelope.id
	} as const

	switch (input.action.type) {
		case 'call_skill': {
			if (!input.skillRegistry.get(input.action.skillId)) {
				throw new UnknownSkillError(input.action.skillId)
			}

			return [
				input.makeEnvelope({
					...base,
					to: `skill/${input.action.skillId}`,
					type: 'skill.request',
					payload: {
						intentId: input.state.intentId,
						callId: input.action.callId,
						request: input.action.request,
						...readAttachmentContext(input.envelope.payload),
						input: input.action.payload
					}
				})
			]
		}
		case 'reply_user':
			return [
				input.makeEnvelope({
					...base,
					to: 'human',
					type: 'human.message',
					payload: {
						intentId: input.state.intentId,
						message: input.action.message
					}
				})
			]
		case 'ask_user':
			return [
				input.makeEnvelope({
					...base,
					to: 'human',
					type: 'human.question',
					payload: {
						intentId: input.state.intentId,
						question: input.action.question
					}
				})
			]
		case 'complete':
			return input.action.message
				? [
						input.makeEnvelope({
							...base,
							to: 'human',
							type: 'human.message',
							payload: {
								intentId: input.state.intentId,
								message: input.action.message
							}
						})
					]
				: []
		case 'fail':
			return input.action.message
				? [
						input.makeEnvelope({
							...base,
							to: 'human',
							type: 'human.message',
							payload: {
								intentId: input.state.intentId,
								message: input.action.message
							}
						})
					]
				: []
		default:
			return []
	}
}

function readAttachmentContext(payload: unknown): {
	attachmentScopeId?: string
	attachments?: unknown[]
} {
	const record = toRecord(payload)
	const userInput = toRecord(record.userInput)

	return {
		attachmentScopeId: readString(record.attachmentScopeId) ?? readString(userInput.attachmentScopeId),
		attachments: readAttachments(record.attachments) ?? readAttachments(userInput.attachments)
	}
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readAttachments(value: unknown): unknown[] | undefined {
	return Array.isArray(value) ? value : undefined
}

export function createLifecycleEnvelope(input: {
	fromActor: string
	state: IntentState
	envelope: EnvelopeRecord
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => EnvelopeInput
}): EnvelopeInput {
	return input.makeEnvelope({
		from: input.fromActor,
		to: 'dispatcher',
		type: 'intent.lifecycle',
		correlationId: input.envelope.correlationId,
		causationId: input.envelope.id,
		payload: {
			intentId: input.state.intentId,
			title: input.state.title,
			summary: input.state.summary,
			status: input.state.status
		}
	})
}