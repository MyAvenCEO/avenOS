import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'

import {
	createSkillRegistry,
	createSkillSupervisorHandler,
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

test('supervisor reply action returns to sender', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: { skillId: 'memory', workers: {}, calls: {} },
					actions: [{ type: 'reply', messageType: 'memory.reply', payload: { ok: true } }]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({ fromActor: 'intent/123' }),
		context: makeContext()
	})

	expect(result.outgoing).toHaveLength(1)
	expect(result.outgoing?.[0]).toMatchObject({
		fromActor: 'skill/memory',
		toActor: 'intent/123',
		type: 'memory.reply',
		payload: { ok: true }
	})
})

test('supervisor route_worker action targets skill-worker/<skillId>/<workerId>', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: { skillId: 'memory', workers: {}, calls: {} },
					actions: [
						{
							type: 'route_worker',
							workerId: 'topic-jaensen-architecture',
							messageType: 'memory.remember',
							payload: { topic: 'jaensen' }
						}
					]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skill-worker/memory/topic-jaensen-architecture',
		type: 'memory.remember',
		payload: { topic: 'jaensen' }
	})
})

test('supervisor spawn_worker includes initialState', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				return {
					state: { skillId: 'memory', workers: {}, calls: {} },
					actions: [
						{
							type: 'spawn_worker',
							workerId: 'job-01J',
							initialState: { phase: 'seeded' },
							messageType: 'memory.remember',
							payload: { topic: 'architecture' }
						}
					]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skill-worker/memory/job-01J',
		payload: {
			topic: 'architecture',
			initialState: { phase: 'seeded' }
		}
	})
})

test('supervisor deterministically routes skill.request and stores call mapping', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				throw new Error('brain should not run for skill.request')
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({
			type: 'skill.request',
			payload: { intentId: 'intent-123', callId: 'call-1', request: 'Remember this', input: { text: 'hello' }, workerPolicy: 'ephemeral' }
		}),
		context: makeContext()
	})

	expect(result.state).toMatchObject({
		workers: {
			'call-1': expect.objectContaining({ workerId: 'call-1', intentId: 'intent-123', callId: 'call-1', status: 'active' })
		},
		calls: {
			'call-1': { callId: 'call-1', intentId: 'intent-123', workerId: 'call-1', status: 'active' }
		}
	})
	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skill-worker/memory/call-1',
		type: 'memory.run',
		payload: expect.objectContaining({ intentId: 'intent-123', callId: 'call-1', initialState: {} })
	})
})

test('supervisor deterministically forwards worker result back to intent', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				throw new Error('brain should not run for skill.worker.result')
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skill/memory', 'skill-supervisor', {
			skillId: 'memory',
			workers: { workerA: { workerId: 'workerA', status: 'active', intentId: 'intent-123', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', intentId: 'intent-123', workerId: 'workerA', status: 'active' } }
		}),
		envelope: makeEnvelopeRecord({
			fromActor: 'skill-worker/memory/workerA',
			type: 'skill.worker.result',
			payload: { workerId: 'workerA', callId: 'call-1', result: { ok: true }, completed: true }
		}),
		context: makeContext()
	})

	expect(result.state).toMatchObject({
		workers: { workerA: expect.objectContaining({ status: 'completed' }) },
		calls: { 'call-1': expect.objectContaining({ status: 'completed' }) }
	})
	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'intent/intent-123',
		type: 'skill.result',
		payload: { intentId: 'intent-123', callId: 'call-1', result: { ok: true } }
	})
})

function makeActor(id: string, kind: string, state: unknown) {
	return {
		id,
		kind,
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
		fromActor: 'intent/default',
		toActor: 'skill/memory',
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