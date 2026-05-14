import { expect, test } from 'bun:test'
import type { EnvelopeInput, EnvelopeRecord } from '@jaensen/persistence-sqlite'

import {
	createSkillRegistry,
	createSkillSupervisorHandler,
	SkillValidationError,
	type SkillDefinition
} from '../src/index'

const skill: SkillDefinition = {
	id: 'memory',
	path: 'memory/SKILL.md',
	description: 'Memory skill',
	directActors: ['skills/pdf'],
	frontmatter: { id: 'memory', description: 'Memory skill' },
	body: '# Memory',
	bodyHash: 'hash-memory',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('skill.bootstrap preserves state and emits no commands', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const initialState = { skillId: 'memory', workers: {}, calls: {} }
	const result = await handler.activate({
		actor: makeActor(initialState),
		envelope: makeEnvelopeRecord({ type: 'skill.bootstrap', payload: { skillId: 'memory' } }),
		context: makeContext()
	})
	expect(result.nextState).toEqual(initialState)
	expect(sentEnvelopes(result)).toEqual([])
})

test('skill.request deterministically spawns worker and stores root call mapping', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const result = await handler.activate({
		actor: makeActor({ skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({
			type: 'skill.request',
			payload: { intentId: 'intent-123', callId: 'call-1', request: 'Remember this', input: { text: 'hello' }, workerPolicy: 'ephemeral' }
		}),
		context: makeContext()
	})
	expect(result.nextState).toMatchObject({ calls: { 'call-1': expect.objectContaining({ rootCallId: 'call-1' }) } })
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: 'skills/memory/call-1',
		payload: expect.objectContaining({ callId: 'call-1', rootCallId: 'call-1' })
	})
})

test('child skill.request preserves existing rootCallId', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const result = await handler.activate({
		actor: makeActor({ skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({
			fromActor: 'skills/pdf/worker-1',
			type: 'skill.request',
			payload: { callId: 'child-1', parentCallId: 'parent-1', rootCallId: 'root-1', replyTo: 'skills/pdf/worker-1', request: 'Nested', input: {} }
		}),
		context: makeContext()
	})
	expect(result.nextState).toMatchObject({ calls: { 'child-1': expect.objectContaining({ rootCallId: 'root-1', parentCallId: 'parent-1' }) } })
})

test('worker result routes back to owner with root ids', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const result = await handler.activate({
		actor: makeActor({
			skillId: 'memory',
			workers: { workerA: { workerId: 'workerA', status: 'active', intentId: 'intent-123', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', workerId: 'workerA', status: 'active', intentId: 'intent-123', replyTo: 'intents/intent-123', rootCallId: 'root-1' } }
		}),
		envelope: makeEnvelopeRecord({ type: 'skill.worker.result', fromActor: 'skills/memory/workerA', payload: { workerId: 'workerA', callId: 'call-1', rootCallId: 'root-1', result: { ok: true }, completed: true } }),
		context: makeContext()
	})
	expect(result.nextState).toMatchObject({ calls: { 'call-1': expect.objectContaining({ status: 'completed' }) } })
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: 'intents/intent-123',
		payload: expect.objectContaining({ callId: 'call-1', rootCallId: 'root-1', workerId: 'workerA' })
	})
	expect(sentEnvelopes(result)[0].payload).not.toHaveProperty('parentCallId')
})

test('worker result routes child completion by payload.callId, not parentCallId', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const result = await handler.activate({
		actor: makeActor({
			skillId: 'memory',
			workers: { workerA: { workerId: 'workerA', status: 'active', intentId: 'intent-123', callId: 'child-call', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: {
				'child-call': {
					callId: 'child-call',
					workerId: 'workerA',
					status: 'active',
					intentId: 'intent-123',
					replyTo: 'skills/parent/worker-1',
					rootCallId: 'parent-call',
					parentCallId: 'parent-call'
				}
			}
		}),
		envelope: makeEnvelopeRecord({
			type: 'skill.worker.result',
			fromActor: 'skills/memory/workerA',
			payload: {
				workerId: 'workerA',
				callId: 'child-call',
				parentCallId: 'parent-call',
				rootCallId: 'parent-call',
				result: { ok: true },
				completed: true
			}
		}),
		context: makeContext()
	})

	expect(result.nextState).toMatchObject({ calls: { 'child-call': expect.objectContaining({ status: 'completed' }) } })
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: 'skills/parent/worker-1',
		payload: expect.objectContaining({
			callId: 'child-call',
			parentCallId: 'parent-call',
			rootCallId: 'parent-call'
		})
	})
})

test('unknown supervisor message throws SkillValidationError', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	await expect(handler.activate({
		actor: makeActor({ skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({ type: 'memory.custom' }),
		context: makeContext()
	})).rejects.toThrow(SkillValidationError)
})

function makeActor(state: unknown) {
	return { id: 'skills/memory', kind: 'skill-supervisor', status: 'active' as const, state, version: 0, createdAt: '2026-05-12T00:00:00.000Z', updatedAt: '2026-05-12T00:00:00.000Z' }
}

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return { id: 'env-1', fromActor: 'intents/default', toActor: 'skills/memory', type: 'memory.remember', correlationId: 'corr-1', causationId: null, payload: {}, status: 'queued', availableAt: '2026-05-12T00:00:00.000Z', attempts: 0, maxAttempts: 25, lockedBy: null, lockedUntil: null, lastError: null, createdAt: '2026-05-12T00:00:00.000Z', updatedAt: '2026-05-12T00:00:00.000Z', ...overrides }
}

function makeContext() {
	return {
		now: new Date('2026-05-12T00:00:00.000Z'),
		signal: new AbortController().signal,
		generateId: () => 'generated-id',
		contextSnapshotSeq: 0,
		queryContext: async () => [],
		makeEnvelope(input: { from: string; to: string; type: string; payload: unknown; correlationId?: string; causationId?: string; availableAt?: Date }) {
			return { id: 'generated-envelope', fromActor: input.from, toActor: input.to, type: input.type, correlationId: input.correlationId ?? 'corr-1', causationId: input.causationId, payload: input.payload, availableAt: input.availableAt }
		}
	}
}

function sentEnvelopes(result: { commands: Array<{ type: string; envelope?: EnvelopeInput }> }): EnvelopeInput[] {
	return result.commands.filter((command): command is { type: 'send_envelope'; envelope: EnvelopeInput } => command.type === 'send_envelope' && Boolean(command.envelope)).map((command) => command.envelope)
}