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
	directActors: ['skill/files'],
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
			intentId: 'intent-123',
			callId: 'call-1',
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

test('worker sends fallback skill.worker.result when it returns only state for a call', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async run() {
				return {
					state: { lookedUp: true }
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill-worker/memory/call-lookup-1', {}),
		envelope: makeEnvelopeRecord({
			toActor: 'skill-worker/memory/call-lookup-1',
			payload: { intentId: 'intent-123', callId: 'call-lookup-1' }
		}),
		context: makeContext()
	})

	expect(result.outgoing).toHaveLength(1)
	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skill/memory',
		type: 'skill.worker.result',
		payload: {
			workerId: 'call-lookup-1',
			intentId: 'intent-123',
			callId: 'call-lookup-1',
			completed: true
		}
	})
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

test('worker call_skill maps to skill.request', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([
			skill,
			{ ...skill, id: 'files', path: 'files/SKILL.md', directActors: [], frontmatter: { id: 'files', description: 'Files skill' } }
		]),
		brain: {
			async run() {
				return {
					state: {},
					actions: [{ type: 'call_skill', to: 'skill/files', callId: 'call-2', request: 'Read file', payload: { path: 'a.txt' } }],
					completed: false
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill-worker/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'call-1' } }),
		context: makeContext()
	})

	expect(result.outgoing).toHaveLength(1)
	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skill/files',
		type: 'skill.request',
		payload: {
			callId: 'call-2',
			request: 'Read file',
			input: { path: 'a.txt' },
			replyTo: 'skill-worker/memory/topic-jaensen-architecture',
			intentId: 'intent-123',
			parentCallId: 'call-1'
		}
	})
})

test('worker call_skill rejects unlisted target', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([{ ...skill, directActors: [] }]),
		brain: {
			async run() {
				return {
					state: {},
					actions: [{ type: 'call_skill', to: 'skill/files', callId: 'call-2', request: 'Read file', payload: {} }],
					completed: false
				}
			}
		}
	})

	await expect(handler.activate({
		actor: makeActor('skill-worker/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})).rejects.toThrow(/may not call unlisted actor skill\/files/)
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
		payload: { intentId: 'intent-123', callId: 'call-1' },
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