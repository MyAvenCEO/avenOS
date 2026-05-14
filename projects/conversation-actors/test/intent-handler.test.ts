import { expect, test } from 'bun:test'
import type { EnvelopeInput, EnvelopeRecord } from '@jaensen/persistence-sqlite'

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
	directActors: [],
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
				return { summary: state.summary }
			}
		}
	})

	const result = await handler.activate({
		actor: makeIntentActor({}, 'intents/intent-123'),
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
	expect(result.nextState).toMatchObject({
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
				return { summary: 'Working' }
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

test('intent call_skill sends to skills/<id>', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					summary: 'Working',
					actions: [
						{
							type: 'call_skill',
							skillId: 'memory',
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

	const outgoing = sentEnvelopes(result)
	expect(outgoing[0]).toMatchObject({
		toActor: 'skills/memory',
		type: 'skill.request',
		payload: {
			intentId: 'intent-123',
			request: 'Remember this',
			input: { text: 'hello' }
		}
	})
	expect(typeof (outgoing[0] as { payload?: { callId?: unknown } }).payload?.callId).toBe('string')
})

test('intent rejects unknown skillId', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					summary: 'Working',
					actions: [
						{
							type: 'call_skill',
							skillId: 'missing',
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
					summary: 'Working',
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

	expect(sentEnvelopes(result)[0]).toMatchObject({
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
					summary: 'Working',
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

	expect(result.nextState as IntentState).toMatchObject({ status: 'waiting_for_user' })
	expect(sentEnvelopes(result)[0]).toMatchObject({
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
					summary: 'Done',
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

	expect(sentEnvelopes(result).some((envelope) => envelope.toActor === 'dispatcher')).toBeTrue()
	expect(sentEnvelopes(result).find((envelope) => envelope.toActor === 'dispatcher')).toMatchObject({
		type: 'intent.lifecycle',
		payload: {
			intentId: 'intent-123',
			title: 'My intent',
			summary: 'Done',
			status: 'completed'
		}
	})
})

	test('intent call_skill still routes through the skills hierarchy', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([
			{ ...skill, id: 'worker/memory', description: 'Nested id still uses supervisor route' }
		]),
		brain: {
			async decide() {
				return {
					summary: 'Working',
					actions: [
						{
							type: 'call_skill',
							skillId: 'worker/memory',
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

	expect(sentEnvelopes(result)[0].toActor).toBe('skills/worker/memory')
	expect(sentEnvelopes(result)[0].toActor.startsWith('skill-worker/')).toBeFalse()
})

test('skill.result is routed through IntentBrain', async () => {
	let seenType: string = 'unseen'
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide({ envelope }) {
				seenType = envelope.type
				return { summary: 'Working' }
			}
		}
	})

	await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord({ type: 'skill.result', fromActor: 'skills/memory' }),
		context: makeContext()
	})

	expect(seenType).toBe('skill.result')
})

test('pendingSkillCalls is populated on call and cleared on skill.result', async () => {
	const handler = createIntentHandler({
		skillRegistry: createSkillRegistry([skill]),
		brain: {
			async decide({ envelope }) {
				if (envelope.type === 'intent.user_input') {
					return {
						summary: 'Calling skill',
						actions: [{ type: 'call_skill', skillId: 'memory', request: 'Remember this', payload: { text: 'hello' } }]
					}
				}
				return { summary: 'Skill completed' }
			}
		}
	})

	const first = await handler.activate({
		actor: makeIntentActor(makeIntentState()),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})
	const firstState = first.nextState as IntentState
	const pendingCallId = Object.keys(firstState.pendingSkillCalls)[0]
	expect(firstState.pendingSkillCalls).toMatchObject({
		[pendingCallId]: expect.objectContaining({ callId: pendingCallId, skillId: 'memory', request: 'Remember this' })
	})

	const second = await handler.activate({
		actor: makeIntentActor(firstState),
		envelope: makeEnvelopeRecord({ type: 'skill.result', fromActor: 'skills/memory', payload: { callId: pendingCallId, result: { ok: true } } }),
		context: makeContext()
	})
	expect((second.nextState as IntentState).pendingSkillCalls).toEqual({})
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

function makeIntentActor(state: unknown, id = 'intents/intent-123') {
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

function makeContext() {
	return {
		now: new Date('2026-05-12T00:00:00.000Z'),
		signal: new AbortController().signal,
		generateId() {
			return 'generated-call-id'
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

function sentEnvelopes(result: { commands: Array<{ type: string; envelope?: EnvelopeInput }> }): EnvelopeInput[] {
	return result.commands
		.filter((command): command is { type: 'send_envelope'; envelope: EnvelopeInput } => command.type === 'send_envelope' && Boolean(command.envelope))
		.map((command) => command.envelope)
}