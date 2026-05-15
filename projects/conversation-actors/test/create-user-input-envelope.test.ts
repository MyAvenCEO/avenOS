import { expect, test } from 'bun:test'

import { DISPATCHER_ACTOR_ID, HUMAN_ACTOR_ID } from '@jaensen/persistence-sqlite'
import { createUserInputEnvelope } from '../src/index'

test('createUserInputEnvelope creates a dispatcher envelope for human input', () => {
	const now = new Date('2026-05-12T00:00:00.000Z')
	const envelope = createUserInputEnvelope({
		id: 'env-user-1',
		text: 'Hello there',
		attachments: [{ id: 'att-1', name: 'brief.txt', mimeType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64) }],
		now
	})

	expect(envelope).toEqual({
		id: 'env-user-1',
		fromActor: HUMAN_ACTOR_ID,
		toActor: DISPATCHER_ACTOR_ID,
		type: 'conversation.user_input',
		runId: 'env-user-1',
		payload: {
			text: 'Hello there',
			attachments: [{ id: 'att-1', name: 'brief.txt', mimeType: 'text/plain', sizeBytes: 12, sha256: 'a'.repeat(64) }],
			attachmentScopeId: undefined,
			intentIdHint: undefined
		},
		createdAt: now,
		availableAt: now
	})
})

test('createUserInputEnvelope includes intentIdHint when provided', () => {
	const now = new Date('2026-05-12T00:00:00.000Z')
	const envelope = createUserInputEnvelope({
		id: 'env-user-2',
		text: 'Here is my answer',
		intentIdHint: 'intent-123',
		now
	})

	expect(envelope.payload).toEqual({
		text: 'Here is my answer',
		attachments: undefined,
		attachmentScopeId: undefined,
		intentIdHint: 'intent-123'
	})
})