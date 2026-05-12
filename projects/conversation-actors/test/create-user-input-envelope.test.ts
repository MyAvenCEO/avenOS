import { expect, test } from 'bun:test'

import { createUserInputEnvelope } from '../src/index'

test('createUserInputEnvelope creates a dispatcher envelope for human input', () => {
	const now = new Date('2026-05-12T00:00:00.000Z')
	const envelope = createUserInputEnvelope({
		id: 'env-user-1',
		text: 'Hello there',
		attachments: [{ id: 'att-1', name: 'brief.txt' }],
		now
	})

	expect(envelope).toEqual({
		id: 'env-user-1',
		fromActor: 'human',
		toActor: 'dispatcher',
		type: 'conversation.user_input',
		correlationId: 'env-user-1',
		payload: {
			text: 'Hello there',
			attachments: [{ id: 'att-1', name: 'brief.txt' }]
		},
		createdAt: now,
		availableAt: now
	})
})