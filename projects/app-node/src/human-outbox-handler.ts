import type { ActorHandler } from '@jaensen/actor-runtime'
import { z } from 'zod'

const humanMessageSchema = z.object({
	intentId: z.string(),
	message: z.string()
})

const humanQuestionSchema = z.object({
	intentId: z.string(),
	question: z.string()
})

export interface HumanOutboxEntry {
	type: 'human.message' | 'human.question'
	intentId: string
	message?: string
	question?: string
	envelopeId: string
	createdAt: string
}

export interface HumanOutboxState {
	messages: HumanOutboxEntry[]
}

export const initialHumanOutboxState: HumanOutboxState = {
	messages: []
}

export function createHumanOutboxHandler(): ActorHandler {
	return {
		kind: 'human-outbox',
		async activate({ actor, envelope }) {
			const state = normalizeHumanOutboxState(actor.state)

			switch (envelope.type) {
				case 'human.message': {
					const parsed = humanMessageSchema.parse(envelope.payload)
					return {
						nextState: {
							messages: [
								...state.messages,
								{
									type: 'human.message',
									intentId: parsed.intentId,
									message: parsed.message,
									envelopeId: envelope.id,
									createdAt: envelope.createdAt
								}
							]
						},
						contextAppends: [],
						commands: []
					}
				}
				case 'human.question': {
					const parsed = humanQuestionSchema.parse(envelope.payload)
					return {
						nextState: {
							messages: [
								...state.messages,
								{
									type: 'human.question',
									intentId: parsed.intentId,
									question: parsed.question,
									envelopeId: envelope.id,
									createdAt: envelope.createdAt
								}
							]
						},
						contextAppends: [],
						commands: []
					}
				}
				default:
					throw new Error(`Human outbox does not accept envelope type: ${envelope.type}`)
			}
		}
	}
}

export function normalizeHumanOutboxState(state: unknown): HumanOutboxState {
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		return { ...initialHumanOutboxState, messages: [] }
	}

	const candidate = state as Partial<HumanOutboxState>
	return {
		messages: Array.isArray(candidate.messages) ? candidate.messages : []
	}
}