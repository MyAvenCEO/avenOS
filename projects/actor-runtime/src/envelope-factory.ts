import { randomUUID } from 'node:crypto'

import type { EnvelopeInput } from '../../persistence-sqlite/src/index'

export function makeEnvelope(input: {
	from: string
	to: string
	type: string
	payload: unknown
	runId?: string
	causedBy?: string
	availableAt?: Date
	createdAt?: Date
}): EnvelopeInput {
	return {
		id: randomUUID(),
		fromActor: input.from,
		toActor: input.to,
		type: input.type,
		runId: input.runId ?? randomUUID(),
		causedBy: input.causedBy,
		payload: input.payload,
		availableAt: input.availableAt,
		createdAt: input.createdAt
	}
}