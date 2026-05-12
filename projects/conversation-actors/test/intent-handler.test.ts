import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'

import { createSkillRegistry, type SkillDefinition } from '../../skills/src/index'

import {
	UnknownSkillError,
	createIntentHandler,
	type IntentState
} from '../src/index'

const skill: SkillDefinition = {
	id: 'memory',
	path: 'memory/SKILL.md',
	description: 'Memory skill',
	frontmatter: { id: 'memory', description: 'Memory skill' },
	body: '# Memory',
	bodyHash: 'hash-memory',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('intent.start initializes intent state', async () => {
	let seenState: IntentState | null = null
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide({ state }) {
				seenState = state
				return { state }
			}
		}
	})

	const result = await handler.activate({
		actor: makeIntentActor({}, 'intent/intent-123'),
		envelope: makeEnvelopeRecord({
			type: 'intent.start',
			payload: {
				intentId: 'intent-123',
				title: 'My intent',
				goal: 'Help the user'
			}
		}),
		context: makeContext()
	})

	expect(seenState).toMatchObject({
		intentId: 'intent-123',
		title: 'My intent',
		goal: 'Help the user',
		status: 'active',
		summary: 'Help the user'
	})
	expect(result.state).toMatchObject({
		intentId: 'intent-123',
		title: 'My intent'
	})
})

test('intent.user_input calls IntentBrain', async () => {
	let calls = 0
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide({ envelope }) {
				calls += 1
				expect(envelope.type).toBe('intent.user_input')
				return { state: makeIntentState() }
			}
		}
	})

	await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(calls).toBe(1)
})

test('intent call_skill sends to skill/<id>', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: makeIntentState(),
					actions: [
						{
							type: 'call_skill',
							skillId: 'memory',
							callId: 'call-1',
							request: 'Remember this',
							payload: { text: 'hello' }
						}
					]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skill/memory',
		type: 'skill.request',
		payload: {
			intentId: 'intent-123',
			callId: 'call-1',
			request: 'Remember this',
			input: { text: 'hello' }
		}
	})
})

test('intent rejects unknown skillId', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: makeIntentState(),
					actions: [
						{
							type: 'call_skill',
							skillId: 'missing',
							callId: 'call-1',
							request: 'Remember this',
							payload: { text: 'hello' }
						}
					]
				}
			}
		}
	})

	await expect(
		handler.activate({
			actor: makeIntentActor(makeIntentState()),
			envelope: makeEnvelopeRecord(),
			context: makeContext()
		})
	).rejects.toThrow(new UnknownSkillError('missing'))
})

test('intent reply_user sends human.message', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: makeIntentState(),
					actions: [{ type: 'reply_user', message: 'Here is the answer' }]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'human',
		type: 'human.message',
		payload: {
			intentId: 'intent-123',
			message: 'Here is the answer'
		}
	})
})

test('intent ask_user sends human.question', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: makeIntentState(),
					actions: [{ type: 'ask_user', question: 'Which project?' }]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.state).toMatchObject({ status: 'waiting_for_user' })
	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'human',
		type: 'human.question'
	})
})

test('intent complete sends lifecycle update to dispatcher', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: makeIntentState(),
					actions: [{ type: 'complete', summary: 'Done', message: 'All set' }]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.some((envelope) => envelope.toActor === 'dispatcher')).toBeTrue()
	expect(result.outgoing?.find((envelope) => envelope.toActor === 'dispatcher')).toMatchObject({
		type: 'intent.lifecycle',
		payload: {
			intentId: 'intent-123',
			title: 'My intent',
			summary: 'Done',
			status: 'completed'
		}
	})
})

test('intent cannot send to skill-worker', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([
			{ ...skill, id: 'worker/memory', description: 'Nested id still uses supervisor route' }
		]),
		brain: {
			async decide() {
				return {
					state: makeIntentState(),
					actions: [
						{
							type: 'call_skill',
							skillId: 'worker/memory',
							callId: 'call-2',
							request: 'Run safely',
							payload: {}
						}
					]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.[0].toActor).toBe('skill/worker/memory')
	expect(result.outgoing?.[0].toActor.startsWith('skill-worker/')).toBeFalse()
})

test('skill.result is routed through IntentBrain', async () => {
	let seenType: string | null = null
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide({ envelope }) {
				seenType = envelope.type
				return { state: makeIntentState() }
			}
		}
	})

	await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord({ type: 'skill.result', fromActor: 'skill/memory' }),
		context: makeContext()
	})

	expect(seenType).toBe('skill.result')
})

function makeIntentState(): IntentState {
	return {
		intentId: 'intent-123',
		title: 'My intent',
		goal: 'Help the user',
		status: 'active',
		summary: 'Working',
		pendingSkillCalls: {}
	}
}

function makeIntentActor(state: unknown, id = 'intent/intent-123') {
	return {
		id,
		kind: 'intent',
		status: 'active' as const,
		state,
		version: 0,
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z'
	}
}

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'dispatcher',
		toActor: 'intent/intent-123',
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