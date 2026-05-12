import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'

import {
	SkillNotFoundError,
	createSkillRegistry,
	createSkillWorkerHandler,
	type SkillDefinition
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

test('worker sends skill.worker.result to supervisor', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async run({ actorState }) {
				return {
					state: actorState,
					result: { stored: true },
					completed: true
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill-worker/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing).toHaveLength(1)
	expect(result.outgoing?.[0]).toMatchObject({
		fromActor: 'skill-worker/memory/topic-jaensen-architecture',
		toActor: 'skill/memory',
		type: 'skill.worker.result',
		correlationId: 'corr-1',
		causationId: 'env-1',
		payload: {
			workerId: 'topic-jaensen-architecture',
			result: { stored: true },
			completed: true
		}
	})
})

test('worker initializes from initialState once', async () => {
	const seenStates: unknown[] = []
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async run({ actorState }) {
				seenStates.push(actorState)
				return {
					state: { persisted: true }
				}
			}
		}
	})

	await handler.activate({
		actor: makeActor('skill-worker/memory/job-01J', {}),
		envelope: makeEnvelopeRecord({ payload: { initialState: { seeded: true } } }),
		context: makeContext()
	})

	await handler.activate({
		actor: makeActor('skill-worker/memory/job-01J', { persisted: true }),
		envelope: makeEnvelopeRecord({ payload: { initialState: { seeded: false } } }),
		context: makeContext()
	})

	expect(seenStates).toEqual([{ seeded: true }, { persisted: true }])
})

test('missing skill fails clearly', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([]),
		brain: {
			async run() {
				return { state: {} }
			}
		}
	})

	await expect(
		handler.activate({
			actor: makeActor('skill-worker/missing/job-01J', {}),
			envelope: makeEnvelopeRecord({ toActor: 'skill-worker/missing/job-01J' }),
			context: makeContext()
		})
	).rejects.toThrow(new SkillNotFoundError('missing'))
})

function makeActor(id: string, state: unknown) {
	return {
		id,
		kind: 'skill-worker',
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
		fromActor: 'skill/memory',
		toActor: 'skill-worker/memory/topic-jaensen-architecture',
		type: 'memory.remember',
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
				id: 'generated-envelope',
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