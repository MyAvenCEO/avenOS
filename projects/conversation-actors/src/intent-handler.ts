import type { ActorDecision, ActorHandler } from '@jaensen/actor-runtime'
import type { ContextAppendInput, EnvelopeRecord } from '@jaensen/persistence-sqlite'
import { z } from 'zod'

import {
	resolveIntentActions,
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
			attachmentScopeId: z.string().trim().min(1).optional(),
			attachments: z
				.array(
					z.object({
						id: z.string(),
						name: z.string(),
						mimeType: z.string(),
						sizeBytes: z.number().nonnegative(),
						sha256: z.string()
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
				})),
				signal: context.signal
			})

			const resolved = resolveIntentActions({
				state: previousState,
				actions: decision.actions ?? [],
				generateId: context.generateId,
				now: context.now
			})
			const actions = resolved.actions
			const nextState = reduceIntentState({
				previousState: resolved.state,
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

			const contextAppends: ContextAppendInput[] = []
			if (envelope.type === 'intent.start') {
				const payload = envelope.payload as Record<string, unknown>
				contextAppends.push({
					scope: { type: 'intent', intentId },
					kind: 'constraint',
					key: 'intent.goal',
					tags: ['intent', 'goal'],
					body: { title: nextState.title, goal: nextState.goal, reason: payload.reason },
					summary: nextState.goal,
					sourceContextItemIds: []
				})
			}
			for (const action of actions) {
				if (action.type === 'call_skill' && action.callId) {
					contextAppends.push({
						scope: { type: 'intent', intentId },
						kind: 'decision',
						key: 'skill.call.requested',
						tags: ['skill', 'request'],
						body: {
							callId: action.callId,
							rootCallId: action.rootCallId ?? action.callId,
							skillId: action.skillId,
							request: action.request,
							input: action.payload
						},
						summary: `${action.skillId}: ${action.request}`,
						sourceContextItemIds: []
					})
				}
			}

			return {
				nextState: nextState,
				contextAppends,
				commands: [
					...(decision.events ?? []).map((event) => ({ type: 'emit_event', event }) as const),
					...outgoing.map((envelope) => ({ type: 'send_envelope', envelope }) as const)
				]
			} satisfies ActorDecision
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