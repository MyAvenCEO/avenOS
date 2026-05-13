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
	directActors: ['skills/files'],
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
		actor: makeActor('skills/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({ fromActor: 'intents/123' }),
		context: makeContext()
	})

	expect(result.outgoing).toHaveLength(1)
	expect(result.outgoing?.[0]).toMatchObject({
		fromActor: 'skills/memory',
		toActor: 'intents/123',
		type: 'memory.reply',
		payload: { ok: true }
	})
})

test('supervisor route_worker action targets skills/<skillId>/<workerId>', async () => {
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
		actor: makeActor('skills/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skills/memory/topic-jaensen-architecture',
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
		actor: makeActor('skills/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skills/memory/job-01J',
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
		actor: makeActor('skills/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
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
			'call-1': { callId: 'call-1', intentId: 'intent-123', workerId: 'call-1', status: 'active', replyTo: 'intents/default' }
		}
	})
	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skills/memory/call-1',
		type: 'memory.run',
		payload: expect.objectContaining({ intentId: 'intent-123', callId: 'call-1', initialState: {} })
	})
})

test('skill.bootstrap does not invoke the brain and preserves state', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async decide() {
				throw new Error('brain should not run for skill.bootstrap')
			}
		}
	})

	const initialState = { skillId: 'memory', workers: {}, calls: {}, bootstrappedAt: '2026-05-12T00:00:00.000Z' }
	const result = await handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', initialState),
		envelope: makeEnvelopeRecord({
			fromActor: 'system',
			toActor: 'skills/memory',
			type: 'skill.bootstrap',
			payload: { skillId: 'memory' }
		}),
		context: makeContext()
	})

	expect(result.state).toEqual({ skillId: 'memory', workers: {}, calls: {} })
	expect(result.outgoing).toEqual([])
	expect(result.events).toEqual([])
})

test('supervisor call_skill maps to skill.request', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([
			skill,
			{ ...skill, id: 'files', path: 'files/SKILL.md', directActors: [], frontmatter: { id: 'files', description: 'Files skill' } }
		]),
		brain: {
			async decide() {
				return {
					state: { skillId: 'memory', workers: {}, calls: {} },
					actions: [{ type: 'call_skill', to: 'skills/files', callId: 'call-2', request: 'Read file', payload: { path: 'a.txt' } }]
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'parent-1' } }),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		fromActor: 'skills/memory',
		toActor: 'skills/files',
		type: 'skill.request',
		correlationId: 'corr-1',
		causationId: 'env-1',
		payload: {
			callId: 'call-2',
			request: 'Read file',
			input: { path: 'a.txt' },
			replyTo: 'skills/memory',
			intentId: 'intent-123',
			parentCallId: 'parent-1'
		}
	})
})

test('supervisor call_skill rejects unlisted target', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([
			{ ...skill, directActors: [] },
			{ ...skill, id: 'files', path: 'files/SKILL.md', directActors: [], frontmatter: { id: 'files', description: 'Files skill' } }
		]),
		brain: {
			async decide() {
				return {
					state: { skillId: 'memory', workers: {}, calls: {} },
					actions: [{ type: 'call_skill', to: 'skills/files', callId: 'call-2', request: 'Read file', payload: {} }]
				}
			}
		}
	})

	await expect(handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})).rejects.toThrow(/may not call unlisted actor skills\/files/)
})

test('direct skill request stores replyTo', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: { async decide() { throw new Error('brain should not run for skill.request') } }
	})

	const result = await handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', { skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({
			fromActor: 'skills/pdf',
			type: 'skill.request',
			payload: { callId: 'call-1', request: 'Remember', replyTo: 'skills/pdf/job1', parentCallId: 'parent-1', input: {} }
		}),
		context: makeContext()
	})

	expect(result.state).toMatchObject({
		calls: {
			'call-1': expect.objectContaining({ replyTo: 'skills/pdf/job1', parentCallId: 'parent-1' })
		}
	})
})

test('direct skill result replies to replyTo when no intentId exists', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: { async decide() { throw new Error('brain should not run for skill.worker.result') } }
	})

	const result = await handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', {
			skillId: 'memory',
			workers: { workerA: { workerId: 'workerA', status: 'active', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', workerId: 'workerA', status: 'active', replyTo: 'skills/pdf/job1', parentCallId: 'parent-1' } }
		}),
		envelope: makeEnvelopeRecord({
			fromActor: 'skills/memory/workerA',
			type: 'skill.worker.result',
			payload: { workerId: 'workerA', callId: 'call-1', result: { ok: true }, completed: true }
		}),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skills/pdf/job1',
		type: 'skill.result',
		payload: { callId: 'call-1', parentCallId: 'parent-1', fromSkillId: 'memory', workerId: 'workerA', result: { ok: true } }
	})
})

test('intent-origin skill result still replies to intents/<intentId>', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: { async decide() { throw new Error('brain should not run for skill.worker.result') } }
	})

	const result = await handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', {
			skillId: 'memory',
			workers: { workerA: { workerId: 'workerA', status: 'active', intentId: 'intent-123', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', intentId: 'intent-123', workerId: 'workerA', status: 'active', replyTo: 'intents/intent-123' } }
		}),
		envelope: makeEnvelopeRecord({
			fromActor: 'skills/memory/workerA',
			type: 'skill.worker.result',
			payload: { workerId: 'workerA', callId: 'call-1', result: { ok: true }, completed: true }
		}),
		context: makeContext()
	})

	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'intents/intent-123',
		type: 'skill.result',
		payload: { intentId: 'intent-123', callId: 'call-1', fromSkillId: 'memory', workerId: 'workerA', result: { ok: true } }
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
		actor: makeActor('skills/memory', 'skill-supervisor', {
			skillId: 'memory',
			workers: { workerA: { workerId: 'workerA', status: 'active', intentId: 'intent-123', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', intentId: 'intent-123', workerId: 'workerA', status: 'active' } }
		}),
		envelope: makeEnvelopeRecord({
			fromActor: 'skills/memory/workerA',
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
		toActor: 'intents/intent-123',
		type: 'skill.result',
		payload: { intentId: 'intent-123', callId: 'call-1', result: { ok: true } }
	})
})

test('worker result prefers parentCallId when routing nested child completion', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: { async decide() { throw new Error('brain should not run for skill.worker.result') } }
	})

	const result = await handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', {
			skillId: 'memory',
			workers: {
				workerA: { workerId: 'workerA', status: 'active', intentId: 'intent-123', callId: 'parent-call-1', updatedAt: '2026-05-12T00:00:00.000Z' }
			},
			calls: {
				'parent-call-1': { callId: 'parent-call-1', intentId: 'intent-123', workerId: 'workerA', status: 'active', replyTo: 'skills/pdf/job1' }
			}
		}),
		envelope: makeEnvelopeRecord({
			fromActor: 'skills/memory/workerA',
			type: 'skill.worker.result',
			payload: {
				workerId: 'workerA',
				callId: 'child-call-1',
				parentCallId: 'parent-call-1',
				result: { ok: true },
				completed: true
			}
		}),
		context: makeContext()
	})

	expect(result.state).toMatchObject({
		workers: { workerA: expect.objectContaining({ callId: 'parent-call-1', status: 'completed' }) },
		calls: { 'parent-call-1': expect.objectContaining({ status: 'completed' }) }
	})
	expect(result.outgoing?.[0]).toMatchObject({
		toActor: 'skills/pdf/job1',
		type: 'skill.result',
		payload: expect.objectContaining({ callId: 'parent-call-1', workerId: 'workerA', result: { ok: true } })
	})
})

test('nested child completion resolves parent call without unknown callId error', async () => {
	const handler = createSkillSupervisorHandler({
		registry: createSkillRegistry([skill]),
		brain: { async decide() { throw new Error('brain should not run for skill.worker.result') } }
	})

	const first = await handler.activate({
		actor: makeActor('skills/memory', 'skill-supervisor', {
			skillId: 'memory',
			workers: {
				workerA: { workerId: 'workerA', status: 'active', callId: 'parent-call-1', updatedAt: '2026-05-12T00:00:00.000Z' }
			},
			calls: {
				'parent-call-1': {
					callId: 'parent-call-1',
					workerId: 'workerA',
					status: 'active',
					replyTo: 'skills/pdf/job1'
				}
			}
		}),
		envelope: makeEnvelopeRecord({
			fromActor: 'skills/memory/workerA',
			type: 'skill.worker.result',
			payload: {
				workerId: 'workerA',
				callId: 'child-call-1',
				parentCallId: 'parent-call-1',
				result: { ok: true },
				completed: true
			}
		}),
		context: makeContext()
	})

	expect(first.state).toMatchObject({
		calls: {
			'parent-call-1': expect.objectContaining({ status: 'completed' })
		}
	})
	expect(() => first.outgoing?.[0]).not.toThrow()
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
		fromActor: 'intents/default',
		toActor: 'skills/memory',
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