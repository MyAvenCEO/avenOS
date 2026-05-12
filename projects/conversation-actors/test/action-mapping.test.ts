import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'

import { createSkillRegistry, type SkillDefinition } from '../../skills/src/index'

import {
	UnknownSkillError,
	applyIntentActionStateEffects,
	createLifecycleEnvelope,
	mapIntentActionsToEnvelopes,
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

test('intent ask_user sends human.question and updates status', () => {
	const state = makeIntentState()
	const nextState = applyIntentActionStateEffects({
		state,
		actions: [{ type: 'ask_user', question: 'Which file should I use?' }]
	})
	const outgoing = mapIntentActionsToEnvelopes({
		fromActor: 'intent/intent-123',
		state: nextState,
		actions: [{ type: 'ask_user', question: 'Which file should I use?' }],
		envelope: makeEnvelopeRecord(),
		skillRegistry: createSkillRegistry([skill]),
		makeEnvelope: makeEnvelope
	})

	expect(nextState.status).toBe('waiting_for_user')
	expect(outgoing[0]).toMatchObject({
		toActor: 'human',
		type: 'human.question',
		payload: {
			intentId: 'intent-123',
			question: 'Which file should I use?'
		}
	})
})

test('intent call_skill rejects unknown skillId', () => {
	expect(() =>
		mapIntentActionsToEnvelopes({
			fromActor: 'intent/intent-123',
			state: makeIntentState(),
			actions: [
				{
					type: 'call_skill',
					skillId: 'missing',
					callId: 'call-1',
					request: 'Store this',
					payload: { text: 'hello' }
				}
			],
			envelope: makeEnvelopeRecord(),
			skillRegistry: createSkillRegistry([skill]),
			makeEnvelope
		})
	).toThrow(new UnknownSkillError('missing'))
})

test('complete creates lifecycle payload for dispatcher', () => {
	const state = applyIntentActionStateEffects({
		state: makeIntentState(),
		actions: [{ type: 'complete', summary: 'Done', message: 'Finished' }]
	})
	const lifecycle = createLifecycleEnvelope({
		fromActor: 'intent/intent-123',
		state,
		envelope: makeEnvelopeRecord(),
		makeEnvelope
	})

	expect(state.status).toBe('completed')
	expect(lifecycle).toMatchObject({
		toActor: 'dispatcher',
		type: 'intent.lifecycle',
		payload: {
			intentId: 'intent-123',
			title: 'My intent',
			summary: 'Done',
			status: 'completed'
		}
	})
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

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'dispatcher',
		toActor: 'intent/intent-123',
		type: 'intent.user_input',
		correlationId: 'corr-1',
		causationId: null,
		payload: {},
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

function makeEnvelope(input: {
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