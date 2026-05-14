import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type { DispatcherState } from '@jaensen/conversation-actors'

import {
	FlueBrainValidationError,
	createFlueDispatcherBrain
} from '../src/index'

test('dispatcher uses actor/dispatcher session', async () => {
	const calls: string[] = []
	const brain = createFlueDispatcherBrain({
		harness: {
			async session(name) {
				calls.push(name)
				return {
					async prompt() {
						return { type: 'create_intent', title: 'Trip planning', initialGoal: 'Plan a trip', reason: 'New goal' }
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		}
	})

	await brain.route({ state: makeDispatcherState(), envelope: makeEnvelopeRecord(), userInput: { text: 'Plan a trip', attachments: [] } })

	expect(calls).toEqual(['actor/dispatcher'])
})

test('dispatcher accepts create_intent output', async () => {
	const brain = createFlueDispatcherBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return { type: 'create_intent', title: 'Trip planning', initialGoal: 'Plan a trip', reason: 'Distinct goal' }
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		}
	})

	await expect(
		brain.route({ state: makeDispatcherState(), envelope: makeEnvelopeRecord(), userInput: { text: 'Plan a trip', attachments: [] } })
	).resolves.toEqual({ type: 'create_intent', title: 'Trip planning', initialGoal: 'Plan a trip', reason: 'Distinct goal' })
})

test('dispatcher rejects route to unknown intent', async () => {
	const brain = createFlueDispatcherBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return { type: 'route_existing_intent', intentId: 'missing', reason: 'Follow-up' }
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		}
	})

	await expect(
		brain.route({ state: makeDispatcherState(), envelope: makeEnvelopeRecord(), userInput: { text: 'hello', attachments: [] } })
	).rejects.toThrow(FlueBrainValidationError)
})

test('dispatcher rejects route to completed intent', async () => {
	const brain = createFlueDispatcherBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return { type: 'route_existing_intent', intentId: 'intent-1', reason: 'Follow-up' }
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		}
	})

	await expect(
		brain.route({ state: makeDispatcherState('completed'), envelope: makeEnvelopeRecord(), userInput: { text: 'hello', attachments: [] } })
	).rejects.toThrow('may not route to completed or failed intents')
})

test('dispatcher rejects empty title/goal', async () => {
	const brain = createFlueDispatcherBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return { type: 'create_intent', title: '   ', initialGoal: '', reason: 'why' }
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		}
	})

	await expect(
		brain.route({ state: makeDispatcherState(), envelope: makeEnvelopeRecord(), userInput: { text: 'hello', attachments: [] } })
	).rejects.toThrow(FlueBrainValidationError)
})

function makeDispatcherState(status: 'active' | 'waiting_for_user' | 'completed' | 'failed' = 'active'): DispatcherState {
	return {
		activeIntents: {
			'intent-1': {
				intentId: 'intent-1',
				title: 'Existing intent',
				summary: 'Working',
				status,
				lastActivityAt: '2026-05-12T00:00:00.000Z'
			}
		}
	}
}

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'human',
		toActor: 'dispatcher',
		type: 'conversation.user_input',
		correlationId: 'corr-1',
		causationId: null,
		payload: { text: 'hello', attachments: [] },
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