import { randomUUID } from 'node:crypto'

import type { EnvelopeInput } from '@jaensen/persistence-sqlite'

import type { UserAttachment } from './types'

export function createUserInputEnvelope(input: {
	id?: string
	text: string
	attachments?: UserAttachment[]
	attachmentScopeId?: string
	intentIdHint?: string
	now: Date
}): EnvelopeInput {
	const id = input.id ?? randomUUID()
	return {
		id,
		fromActor: 'human',
		toActor: 'dispatcher',
		type: 'conversation.user_input',
		correlationId: id,
		payload: {
			text: input.text,
			attachments: input.attachments,
			attachmentScopeId: input.attachmentScopeId,
			intentIdHint: input.intentIdHint
		},
		createdAt: input.now,
		availableAt: input.now
	}
}