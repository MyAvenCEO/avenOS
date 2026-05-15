import { expect, test } from 'bun:test'
import { HUMAN_ACTOR_ID, createIntentActorId, type ActorRecord, type EnvelopeRecord } from '@jaensen/persistence-sqlite'

import { createHumanOutboxHandler, initialHumanOutboxState } from '../src/index'

test('human outbox appends human.message payloads', async () => {
	const handler = createHumanOutboxHandler()
	const result = await handler.activate({
		actor: makeActor(initialHumanOutboxState),
		envelope: makeEnvelope('human.message', { intentId: 'intent-1', message: 'Hello' }),
		context: makeContext()
	})

	expect(result.nextState).toEqual({
		messages: [
			{
				type: 'human.message',
				intentId: 'intent-1',
				message: 'Hello',
				envelopeId: 'env-1',
				createdAt: '2026-05-12T00:00:00.000Z'
			}
		]
	})
	expect(result.commands).toEqual([])
})

test('human outbox appends human.question payloads', async () => {
	const handler = createHumanOutboxHandler()
	const result = await handler.activate({
		actor: makeActor(initialHumanOutboxState),
		envelope: makeEnvelope('human.question', { intentId: 'intent-1', question: 'Need more detail?' }),
		context: makeContext()
	})

	expect(result.nextState).toEqual({
		messages: [
			{
				type: 'human.question',
				intentId: 'intent-1',
				question: 'Need more detail?',
				envelopeId: 'env-1',
				createdAt: '2026-05-12T00:00:00.000Z'
			}
		]
	})
})

function makeActor(state: unknown): ActorRecord {
	return {
		id: HUMAN_ACTOR_ID,
		kind: 'human-outbox',
		status: 'active',
		state,
		version: 0,
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z'
	}
}

function makeEnvelope(type: string, payload: unknown): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: createIntentActorId('intent-1'),
		toActor: HUMAN_ACTOR_ID,
		type,
		runId: 'corr-1',
		causedBy: null,
		payload,
		status: 'queued',
		availableAt: '2026-05-12T00:00:00.000Z',
		attempts: 0,
		maxAttempts: 5,
		lockedBy: null,
		lockedUntil: null,
		lastError: null,
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z'
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
		makeEnvelope() {
			throw new Error('unexpected')
		}
	}
}