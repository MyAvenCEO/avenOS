import type { EnvelopeInput, EnvelopeRecord } from '@jaensen/persistence-sqlite'

import { UnknownSkillError } from './errors'
import type { IntentAction, IntentState, SkillRegistry } from './types'

export function applyIntentActionStateEffects(input: {
	state: IntentState
	actions: IntentAction[]
}): IntentState {
	let nextState = input.state

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
			default:
				break
		}
	}

	return nextState
}

export function mapIntentActionsToEnvelopes(input: {
	fromActor: string
	state: IntentState
	actions: IntentAction[]
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