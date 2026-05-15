import { expect, test } from 'bun:test'
import {
	DISPATCHER_ACTOR_ID,
	HUMAN_ACTOR_ID,
	createIntentActorId,
	type EnvelopeInput,
	type EnvelopeRecord
} from '@jaensen/persistence-sqlite'

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

	const outgoing = sentEnvelopes(result)
	expect(result.nextState).toEqual(initialDispatcherState)
	expect(outgoing).toHaveLength(1)
	expect(outgoing[0]).toMatchObject({
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('intent-123'),
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

	const outgoing = sentEnvelopes(result)
	expect(result.nextState).toEqual(state)
	expect(outgoing[0]).toMatchObject({
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('intent-123'),
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

	expect(sentEnvelopes(result)[0]).toMatchObject({
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('intent-123'),
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
		nextState: {
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
		commands: []
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

	expect(sentEnvelopes(result).every((envelope) => envelope.toActor !== HUMAN_ACTOR_ID)).toBeTrue()
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

	expect(sentEnvelopes(result).every((envelope) => !envelope.toActor.startsWith('skills/'))).toBeTrue()
})

function makeDispatcherActor(state: unknown) {
	return {
		id: DISPATCHER_ACTOR_ID,
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
		fromActor: HUMAN_ACTOR_ID,
		toActor: DISPATCHER_ACTOR_ID,
		type: 'conversation.user_input',
		runId: 'corr-1',
		causedBy: null,
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
		fromActor: createIntentActorId('intent-404'),
		toActor: DISPATCHER_ACTOR_ID,
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
		signal: new AbortController().signal,
		generateId() {
			return 'generated-id'
		},
		contextSnapshotSeq: 0,
		async queryContext() {
			return []
		},
		makeEnvelope(input: {
			from: string
			to: string
			type: string
			payload: unknown
			runId?: string
			causedBy?: string
			availableAt?: Date
		}) {
			return {
				id: `${input.to}:${input.type}`,
				fromActor: input.from,
				toActor: input.to,
				type: input.type,
				runId: input.runId ?? 'corr-1',
				causedBy: input.causedBy,
				payload: input.payload,
				availableAt: input.availableAt
			}
		}
	}
}

function sentEnvelopes(result: { commands: Array<{ type: string; envelope?: EnvelopeInput }> }): EnvelopeInput[] {
	return result.commands
		.filter((command): command is { type: 'send_envelope'; envelope: EnvelopeInput } => command.type === 'send_envelope' && Boolean(command.envelope))
		.map((command) => command.envelope)
}