import { randomUUID } from 'node:crypto'

import type { ActorCommand, ActorDecision, ActorHandler } from '@jaensen/actor-runtime'
import {
	DISPATCHER_ACTOR_ID,
	createIntentActorId,
	type ContextAppendInput
} from '@jaensen/persistence-sqlite'
import { z } from 'zod'

import { UnknownIntentError, ConversationActorsValidationError } from './errors'
import { initialDispatcherState, normalizeDispatcherState } from './dispatcher-state'
import type { CreateDispatcherHandlerInput, DispatcherState, UserAttachment } from './types'

const attachmentSchema = z.object({
	id: z.string(),
	name: z.string(),
	mimeType: z.string(),
	sizeBytes: z.number().nonnegative(),
	sha256: z.string()
})

const userInputSchema = z.object({
	text: z.string(),
	attachments: z.array(attachmentSchema).optional(),
	attachmentScopeId: z.string().trim().min(1).optional(),
	intentIdHint: z.string().trim().min(1).optional()
})

const lifecycleSchema = z.object({
	intentId: z.string(),
	title: z.string(),
	summary: z.string(),
	status: z.enum(['active', 'waiting_for_user', 'completed', 'failed'])
})

export function createDispatcherHandler(input: CreateDispatcherHandlerInput): ActorHandler {
	const createIntentId = input.createIntentId ?? randomUUID

	return {
		kind: 'dispatcher',
		async activate({ envelope, actor, context }) {
			const state = normalizeDispatcherState(actor.state)

			switch (envelope.type) {
				case 'conversation.user_input':
					return handleUserInput({ state, envelope, context, input, createIntentId })
				case 'intent.lifecycle':
					return handleLifecycle({ state, envelope })
				default:
					throw new ConversationActorsValidationError(
						`Dispatcher does not accept envelope type: ${envelope.type}`
					)
			}
		}
	}
}

async function handleUserInput(input: {
	state: DispatcherState
	envelope: Parameters<ActorHandler['activate']>[0]['envelope']
	context: Parameters<ActorHandler['activate']>[0]['context']
	input: CreateDispatcherHandlerInput
	createIntentId: () => string
}): Promise<ActorDecision> {
	const parsed = userInputSchema.safeParse(input.envelope.payload)
	if (!parsed.success) {
		throw new ConversationActorsValidationError('Invalid conversation.user_input payload', {
			cause: parsed.error
		})
	}

	const userInput = {
		text: parsed.data.text,
		attachments: (parsed.data.attachments ?? []) as UserAttachment[],
		attachmentScopeId: parsed.data.attachmentScopeId,
		intentIdHint: parsed.data.intentIdHint
	}

	const hintedIntentId = userInput.intentIdHint
	if (hintedIntentId) {
		const hintedIntent = input.state.activeIntents[hintedIntentId]
		if (hintedIntent && hintedIntent.status !== 'completed' && hintedIntent.status !== 'failed') {
			const commands: ActorCommand[] = [
				{ type: 'send_envelope', envelope: input.context.makeEnvelope({
					from: DISPATCHER_ACTOR_ID,
					to: createIntentActorId(hintedIntentId),
					type: 'intent.user_input',
					runId: input.envelope.runId,
					causedBy: input.envelope.id,
					payload: userInput
				}) }
			]
			return {
				nextState: input.state,
				contextAppends: [buildUserInputContextAppend(input.envelope.runId, userInput)],
				commands
			}
		}
	}

	const decision = await input.input.brain.route({
		state: input.state,
		envelope: input.envelope,
		userInput
	})

	if (decision.type === 'route_existing_intent') {
		if (!input.state.activeIntents[decision.intentId]) {
			throw new UnknownIntentError(decision.intentId)
		}

		const commands: ActorCommand[] = [
			{ type: 'send_envelope', envelope: input.context.makeEnvelope({
				from: DISPATCHER_ACTOR_ID,
				to: createIntentActorId(decision.intentId),
				type: 'intent.user_input',
				runId: input.envelope.runId,
				causedBy: input.envelope.id,
				payload: userInput
			}) }
		]
		return {
			nextState: input.state,
			contextAppends: [buildUserInputContextAppend(input.envelope.runId, userInput)],
			commands
		}
	}

	const intentId = input.createIntentId()
	const commands: ActorCommand[] = [
		{ type: 'send_envelope', envelope: input.context.makeEnvelope({
			from: DISPATCHER_ACTOR_ID,
			to: createIntentActorId(intentId),
			type: 'intent.start',
			runId: input.envelope.runId,
			causedBy: input.envelope.id,
			payload: {
				intentId,
				title: decision.title,
				goal: decision.initialGoal,
				reason: decision.reason,
				userInput
			}
		}) }
	]

	return {
		nextState: input.state,
		contextAppends: [buildUserInputContextAppend(input.envelope.runId, userInput)],
		commands
	}
}

function handleLifecycle(input: {
	state: DispatcherState
	envelope: Parameters<ActorHandler['activate']>[0]['envelope']
}): ActorDecision {
	const parsed = lifecycleSchema.safeParse(input.envelope.payload)
	if (!parsed.success) {
		throw new ConversationActorsValidationError('Invalid intent.lifecycle payload', {
			cause: parsed.error
		})
	}

	return {
		nextState: {
			activeIntents: {
				...input.state.activeIntents,
				[parsed.data.intentId]: {
					intentId: parsed.data.intentId,
					title: parsed.data.title,
					summary: parsed.data.summary,
					status: parsed.data.status,
					lastActivityAt: input.envelope.createdAt
				}
			}
		},
		contextAppends: [],
		commands: []
	}
}

function buildUserInputContextAppend(runId: string, userInput: {
	text: string
	attachments: UserAttachment[]
	attachmentScopeId?: string
	intentIdHint?: string
}): ContextAppendInput {
	return {
		kind: 'user_input',
		visibility: 'worklog',
		runId,
		key: 'user.message',
		body: userInput,
		summary: userInput.text.slice(0, 240)
	}
}

export { initialDispatcherState }