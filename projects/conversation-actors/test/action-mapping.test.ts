import { expect, test } from 'bun:test'
import {
	DISPATCHER_ACTOR_ID,
	HUMAN_ACTOR_ID,
	createIntentActorId,
	createSkillActorId,
	type EnvelopeRecord
} from '@jaensen/persistence-sqlite'

import { createSkillRegistry, type SkillDefinition } from '../../skills/src/index'

import {
	UnknownSkillError,
	applyIntentActionStateEffects,
	createLifecycleEnvelope,
	mapIntentActionsToEnvelopes,
	resolveIntentActions,
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

test('intent ask_user sends human.question and updates status', () => {
	const state = makeIntentState()
	const nextState = applyIntentActionStateEffects({
		state,
		actions: [{ type: 'ask_user', question: 'Which file should I use?' }]
	})
	const outgoing = mapIntentActionsToEnvelopes({
		fromActor: createIntentActorId('intent-123'),
		state: nextState,
		actions: [{ type: 'ask_user', question: 'Which file should I use?' }],
		envelope: makeEnvelopeRecord(),
		skillRegistry: createSkillRegistry([skill]),
		makeEnvelope: makeEnvelope
	})

	expect(nextState.status).toBe('waiting_for_user')
	expect(outgoing[0]).toMatchObject({
		toActor: HUMAN_ACTOR_ID,
		type: 'human.question',
		payload: {
			intentId: 'intent-123',
			question: 'Which file should I use?'
		}
	})
})

test('intent call_skill rejects unknown skillId', () => {
	const resolved = resolveIntentActions({
		state: makeIntentState(),
		actions: [
			{
				type: 'call_skill',
				skillId: 'missing',
				request: 'Store this',
				payload: { text: 'hello' }
			}
		],
		generateId: () => 'call-1'
	})

	expect(() =>
		mapIntentActionsToEnvelopes({
			fromActor: createIntentActorId('intent-123'),
			state: resolved.state,
			actions: resolved.actions,
			envelope: makeEnvelopeRecord(),
			skillRegistry: createSkillRegistry([skill]),
			makeEnvelope
		})
	).toThrow(new UnknownSkillError('missing'))
})

test('resolveIntentActions assigns runtime-owned call ids', () => {
	const resolved = resolveIntentActions({
		state: makeIntentState(),
		actions: [{ type: 'call_skill', skillId: 'memory', request: 'Store this', payload: { text: 'hello' } }],
		generateId: () => 'runtime-call-1'
	})

	expect(resolved.actions[0]).toMatchObject({ type: 'call_skill', skillId: 'memory', callId: 'runtime-call-1' })
	expect(resolved.state.pendingSkillCalls).toMatchObject({
		'runtime-call-1': expect.objectContaining({ callId: 'runtime-call-1', skillId: 'memory', request: 'Store this' })
	})
})

test('complete creates lifecycle payload for dispatcher', () => {
	const state = applyIntentActionStateEffects({
		state: makeIntentState(),
		actions: [{ type: 'complete', summary: 'Done', message: 'Finished' }]
	})
	const lifecycle = createLifecycleEnvelope({
		fromActor: createIntentActorId('intent-123'),
		state,
		envelope: makeEnvelopeRecord(),
		makeEnvelope
	})

	expect(state.status).toBe('completed')
	expect(lifecycle).toMatchObject({
		toActor: DISPATCHER_ACTOR_ID,
		type: 'intent.lifecycle',
		payload: {
			intentId: 'intent-123',
			title: 'My intent',
			summary: 'Done',
			status: 'completed'
		}
	})
})

test('intent.start userInput attachment context propagates into skill.request', () => {
	const resolved = resolveIntentActions({
		state: makeIntentState(),
		actions: [{ type: 'call_skill', skillId: 'memory', request: 'Read file', payload: { ask: true } }],
		generateId: () => 'call-attach-1'
	})

	const outgoing = mapIntentActionsToEnvelopes({
		fromActor: createIntentActorId('intent-123'),
		state: resolved.state,
		actions: resolved.actions,
		envelope: makeEnvelopeRecord({
			type: 'intent.start',
			payload: {
				userInput: {
					attachmentScopeId: '123e4567-e89b-12d3-a456-426614174000',
					attachments: [{ id: 'att-1', name: 'brief.txt', mimeType: 'text/plain', sizeBytes: 5, sha256: 'a'.repeat(64) }]
				}
			}
		}),
		skillRegistry: createSkillRegistry([skill]),
		makeEnvelope
	})

	expect(outgoing[0]).toMatchObject({
		payload: {
			attachmentScopeId: '123e4567-e89b-12d3-a456-426614174000',
			attachments: [{ id: 'att-1', name: 'brief.txt' }]
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
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('intent-123'),
		type: 'intent.user_input',
		runId: 'corr-1',
		causedBy: null,
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