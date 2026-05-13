import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'

import {
	UnknownIntentError,
	createDispatcherHandler,
	initialDispatcherState,
	type DispatcherState
} from '../src/index'

test('dispatcher creates new intent from user input', async () => {
	const handler = createDispatcherHandler({
		createIntentId: () => 'intent-123',
		brain: {
			async route({ userInput }) {
				expect(userInput).toEqual({ text: 'Need help', attachments: [], intentIdHint: undefined })
				return {
					type: 'create_intent',
					title: 'Help request',
					initialGoal: 'Assist the user',
					reason: 'New conversation'
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeDispatcherActor(initialDispatcherState),
		envelope: makeUserInputEnvelope(),
		context: makeContext()
	})

	expect(result.state).toEqual(initialDispatcherState)
	expect(result.outgoing).toHaveLength(1)
	expect(result.outgoing?.[0]).toMatchObject({
		fromActor: 'dispatcher',
		toActor: 'intents/intent-123',
		type: 'intent.start',
		payload: {
			intentId: 'intent-123',
			title: 'Help request',
			goal: 'Assist the user',
			reason: 'New conversation',
			userInput: { text: 'Need help', attachments: [] }
		}
	})
})

test('dispatcher routes user input to existing intent', async () => {
	const state: DispatcherState = {
		activeIntents: {
			'intent-123': {
				intentId: 'intent-123',
				title: 'Help request',
				summary: 'Assist the user',
				status: 'active',
				lastActivityAt: '2026-05-12T00:00:00.000Z'
			}
		}
	}
	const handler = createDispatcherHandler({
		brain: {
			async route() {
				return {
					type: 'route_existing_intent',
					intentId: 'intent-123',
					reason: 'Follow-up'
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeDispatcherActor(state),
		envelope: makeUserInputEnvelope({ payload: { text: 'More details' } }),
		context: makeContext()
	})

	expect(result.state).toEqual(state)
	expect(result.outgoing?.[0]).toMatchObject({
		fromActor: 'dispatcher',
		toActor: 'intents/intent-123',
		type: 'intent.user_input',
		payload: { text: 'More details', attachments: [] }
	})
})

test('dispatcher routes hinted user input to existing waiting intent without consulting brain', async () => {
	const state: DispatcherState = {
		activeIntents: {
			'intent-123': {
				intentId: 'intent-123',
				title: 'Help request',
				summary: 'Awaiting clarification',
				status: 'waiting_for_user',
				lastActivityAt: '2026-05-12T00:00:00.000Z'
			}
		}
	}
	const handler = createDispatcherHandler({
		brain: {
			async route() {
				throw new Error('brain should not be called for valid intentIdHint')
			}
		}
	})

	const result = await handler.activate({
		actor: makeDispatcherActor(state),
		envelope: makeUserInputEnvelope({ payload: { text: 'Sure, do it', intentIdHint: 'intent-123' } }),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		fromActor: 'dispatcher',
		toActor: 'intents/intent-123',
		type: 'intent.user_input',
		payload: { text: 'Sure, do it', attachments: [], intentIdHint: 'intent-123' }
	})
})

test('dispatcher lifecycle creates or updates tracked intent state', async () => {
	const handler = createDispatcherHandler({
		brain: {
			async route() {
				throw new Error('unreachable')
			}
		}
	})

	await expect(
		handler.activate({
			actor: makeDispatcherActor(initialDispatcherState),
			envelope: makeLifecycleEnvelope({
				payload: {
					intentId: 'intent-404',
					title: 'Ghost',
					summary: 'Should not exist',
					status: 'active'
				}
			}),
			context: makeContext()
		})
	).resolves.toMatchObject({
		state: {
			activeIntents: {
				'intent-404': {
					intentId: 'intent-404',
					title: 'Ghost',
					summary: 'Should not exist',
					status: 'active',
					lastActivityAt: '2026-05-12T00:00:00.000Z'
				}
			}
		},
		outgoing: []
	})
})

test('dispatcher never sends to human', async () => {
	const handler = createDispatcherHandler({
		createIntentId: () => 'intent-123',
		brain: {
			async route() {
				return {
					type: 'create_intent',
					title: 'Help request',
					initialGoal: 'Assist the user',
					reason: 'New conversation'
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeDispatcherActor(initialDispatcherState),
		envelope: makeUserInputEnvelope(),
		context: makeContext()
	})

	expect(result.outgoing?.every((envelope) => envelope.toActor !== 'human')).toBeTrue()
})

test('dispatcher never sends to skill', async () => {
	const handler = createDispatcherHandler({
		createIntentId: () => 'intent-123',
		brain: {
			async route() {
				return {
					type: 'create_intent',
					title: 'Help request',
					initialGoal: 'Assist the user',
					reason: 'New conversation'
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeDispatcherActor(initialDispatcherState),
		envelope: makeUserInputEnvelope(),
		context: makeContext()
	})

	expect(result.outgoing?.every((envelope) => !envelope.toActor.startsWith('skills/'))).toBeTrue()
})

function makeDispatcherActor(state: unknown) {
	return {
		id: 'dispatcher',
		kind: 'dispatcher',
		status: 'active' as const,
		state,
		version: 0,
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z'
	}
}

function makeUserInputEnvelope(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'human',
		toActor: 'dispatcher',
		type: 'conversation.user_input',
		correlationId: 'corr-1',
		causationId: null,
		payload: { text: 'Need help' },
		status: 'queued',
		availableAt: '2026-05-12T00:00:00.000Z',
		attempts: 0,
		maxAttempts: 25,
		lockedBy: null,
		lockedUntil: null,
		lastError: null,
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z',
		...overrides
	}
}

function makeLifecycleEnvelope(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		...makeUserInputEnvelope(),
		id: 'env-life-1',
		fromActor: 'intents/intent-404',
		toActor: 'dispatcher',
		type: 'intent.lifecycle',
		payload: {
			intentId: 'intent-404',
			title: 'Ghost',
			summary: 'Should not exist',
			status: 'active'
		},
		...overrides
	}
}

function makeContext() {
	return {
		now: new Date('2026-05-12T00:00:00.000Z'),
		makeEnvelope(input: {
			from: string
			to: string
			type: string
			payload: unknown
			correlationId?: string
			causationId?: string
			availableAt?: Date
		}) {
			return {
				id: `${input.to}:${input.type}`,
				fromActor: input.from,
				toActor: input.to,
				type: input.type,
				correlationId: input.correlationId ?? 'corr-1',
				causationId: input.causationId,
				payload: input.payload,
				availableAt: input.availableAt
			}
		}
	}
}