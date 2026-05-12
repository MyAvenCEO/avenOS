import type { ActorHandler } from '@jaensen/actor-runtime'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import { z } from 'zod'

import {
	createLifecycleEnvelope,
	mapIntentActionsToEnvelopes
} from './action-mapping'
import { ConversationActorsValidationError } from './errors'
import { assertIntentState, createInitialIntentState, parseIntentActorId } from './intent-state'
import type { CreateIntentHandlerInput, IntentBrainDecision, IntentState } from './types'

const startPayloadSchema = z.object({
	intentId: z.string(),
	title: z.string(),
	goal: z.string(),
	reason: z.string().optional(),
	userInput: z
		.object({
			text: z.string(),
			attachments: z
				.array(
					z.object({
						id: z.string(),
						path: z.string().optional(),
						mimeType: z.string().optional(),
						name: z.string().optional()
					})
				)
				.optional()
		})
		.optional()
})

const acceptedTypes = new Set([
	'intent.start',
	'intent.user_input',
	'skill.result',
	'skill.failed',
	'skill.needs_clarification'
])

export function createIntentHandler(input: CreateIntentHandlerInput): ActorHandler {
	return {
		kind: 'intent',
		async activate({ actor, envelope, context }) {
			if (!acceptedTypes.has(envelope.type)) {
				throw new ConversationActorsValidationError(
					`Intent does not accept envelope type: ${envelope.type}`
				)
			}

			const intentId = parseIntentActorId(actor.id)
			if (!intentId) {
				throw new ConversationActorsValidationError(`Invalid intent actor id: ${actor.id}`)
			}

			const previousState =
				envelope.type === 'intent.start'
					? getStartState({ actorId: actor.id, payload: envelope.payload })
					: assertIntentState(actor.state, actor.id)

			const decision = await input.brain.decide({
				state: previousState,
				envelope,
				availableSkills: input.skillRegistry.list().map((skill) => ({
					id: skill.id,
					description: skill.description
				}))
			})

			const actions = decision.actions ?? []
			const nextState = reduceIntentState({
				previousState,
				envelope,
				decision,
				now: context.now
			})

			const outgoing = mapIntentActionsToEnvelopes({
				fromActor: actor.id,
				state: nextState,
				actions,
				envelope,
				skillRegistry: input.skillRegistry,
				makeEnvelope: context.makeEnvelope
			})

			if (hasLifecycleChange(previousState, nextState)) {
				outgoing.push(
					createLifecycleEnvelope({
						fromActor: actor.id,
						state: nextState,
						envelope,
						makeEnvelope: context.makeEnvelope
					})
				)
			}

			return {
				state: nextState,
				events: decision.events ?? [],
				outgoing
			}
		}
	}
}

function reduceIntentState(input: {
	previousState: IntentState
	envelope: EnvelopeRecord
	decision: IntentBrainDecision
	now: Date
}): IntentState {
	let nextState: IntentState = {
		intentId: input.previousState.intentId,
		title: input.previousState.title,
		goal: input.previousState.goal,
		status: input.previousState.status,
		summary: input.decision.summary ?? input.previousState.summary,
		pendingSkillCalls: { ...input.previousState.pendingSkillCalls }
	}

	for (const action of input.decision.actions ?? []) {
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
							createdAt: input.now.toISOString()
						}
					}
				}
				break
			default:
				break
		}
	}

	if (
		input.envelope.type === 'skill.result' ||
		input.envelope.type === 'skill.failed' ||
		input.envelope.type === 'skill.needs_clarification'
	) {
		const payload =
			input.envelope.payload && typeof input.envelope.payload === 'object' && !Array.isArray(input.envelope.payload)
				? (input.envelope.payload as Record<string, unknown>)
				: null
		const callId = typeof payload?.callId === 'string' ? payload.callId : null
		if (callId) {
			const { [callId]: _removed, ...pendingSkillCalls } = nextState.pendingSkillCalls
			nextState = { ...nextState, pendingSkillCalls }
		}
	}

	return nextState
}

function getStartState(input: { actorId: string; payload: unknown }): IntentState {
	const parsed = startPayloadSchema.safeParse(input.payload)
	if (!parsed.success) {
		throw new ConversationActorsValidationError('Invalid intent.start payload', {
			cause: parsed.error
		})
	}

	const actorIntentId = parseIntentActorId(input.actorId)
	if (!actorIntentId || actorIntentId !== parsed.data.intentId) {
		throw new ConversationActorsValidationError(
			`intent.start payload intentId ${parsed.data.intentId} does not match actor ${input.actorId}`
		)
	}

	return createInitialIntentState({
		intentId: parsed.data.intentId,
		title: parsed.data.title,
		goal: parsed.data.goal
	})
}

function hasLifecycleChange(previousState: IntentState, nextState: IntentState): boolean {
	return (
		previousState.status !== nextState.status || previousState.summary !== nextState.summary
	)
}