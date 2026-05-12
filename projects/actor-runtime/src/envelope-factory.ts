import { randomUUID } from 'node:crypto'

import type { EnvelopeInput } from '../../persistence-sqlite/src/index'

export function makeEnvelope(input: {
	from: string
	to: string
	type: string
	payload: unknown
	correlationId?: string
	causationId?: string
	availableAt?: Date
	createdAt?: Date
}): EnvelopeInput {
	return {
		id: randomUUID(),
		fromActor: input.from,
		toActor: input.to,
		type: input.type,
		correlationId: input.correlationId ?? randomUUID(),
		causationId: input.causationId,
		payload: input.payload,
		availableAt: input.availableAt,
		createdAt: input.createdAt
	}
}