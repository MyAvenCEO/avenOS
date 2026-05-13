import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type { IntentState } from '@jaensen/conversation-actors'

import {
	createFlueIntentBrain
} from '../src/index'

test('intent uses actor/intents/<intentId> session', async () => {
	const calls: string[] = []
	const brain = createFlueIntentBrain({
		harness: {
			async session(name) {
				calls.push(name)
				return {
					async prompt() {
						return {
							summary: 'Working',
							actions: [{ type: 'reply_user', message: 'hi' }]
						}
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

	await brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })

	expect(calls).toEqual(['actor/intents/intent-123'])
})

test('intent accepts call_skill for known skill', async () => {
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return {
							summary: 'Working',
							actions: [{ type: 'call_skill', skillId: 'memory', request: 'Remember this', payload: { text: 'hello' } }]
						}
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
	).resolves.toMatchObject({ actions: [{ type: 'call_skill', skillId: 'memory' }] })
})

test('intent falls back when model requests an unknown skill twice', async () => {
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return {
							summary: 'Working',
							actions: [{ type: 'call_skill', skillId: 'missing', request: 'Remember this', payload: {} }]
						}
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
	).resolves.toMatchObject({
		summary: 'Working',
		events: [{ eventType: 'intent.brain.invalid_output' }],
		actions: [{ type: 'ask_user' }]
	})
})

	test('intent falls back safely after invalid output and one repair attempt', async () => {
		let attempts = 0
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
							attempts += 1
							return { actions: [{ type: 'ask_user' }] }
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
		).resolves.toMatchObject({
			summary: 'Working',
			events: [{ eventType: 'intent.brain.invalid_output' }],
			actions: [{ type: 'ask_user' }]
		})
		expect(attempts).toBe(2)
})

	test('intent accepts summary-only output', async () => {
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
							return { summary: 'Updated summary' }
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
		).resolves.toEqual({ summary: 'Updated summary' })
})

	test('intent accepts ask_user without model-owned status', async () => {
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
							return { actions: [{ type: 'ask_user', question: 'Need more info?' }] }
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
		).resolves.toMatchObject({ actions: [{ type: 'ask_user', question: 'Need more info?' }] })
})

	test('intent accepts complete without model-owned status', async () => {
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
							return { actions: [{ type: 'complete', summary: 'Done' }] }
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
		).resolves.toMatchObject({ actions: [{ type: 'complete', summary: 'Done' }] })
})

	test('intent accepts fail without model-owned status', async () => {
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
							return { actions: [{ type: 'fail', reason: 'Nope' }] }
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
		).resolves.toMatchObject({ actions: [{ type: 'fail', reason: 'Nope' }] })
})

test('Flue response .data is normalized before validation', async () => {
	const brain = createFlueIntentBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return {
							data: {
								summary: 'Normalized',
								actions: [{ type: 'reply_user', message: 'Normalized' }]
							}
						}
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
		brain.decide({ state: makeIntentState(), envelope: makeEnvelopeRecord(), availableSkills: makeSkills() })
	).resolves.toMatchObject({ summary: 'Normalized', actions: [{ type: 'reply_user', message: 'Normalized' }] })
})

function makeIntentState(status: 'active' | 'waiting_for_user' | 'completed' | 'failed' = 'active'): IntentState {
	return {
		intentId: 'intent-123',
		title: 'My intent',
		goal: 'Help the user',
		status,
		summary: 'Working',
		pendingSkillCalls: {}
	}
}

function makeSkills() {
	return [{ id: 'memory', description: 'Remember facts' }]
}

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'dispatcher',
		toActor: 'intents/intent-123',
		type: 'intent.user_input',
		correlationId: 'corr-1',
		causationId: null,
		payload: { text: 'hello' },
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