import { expect, test } from 'bun:test'
import {
	createIntentActorId,
	createSkillActorId,
	createWorkerActorId,
	createStableWorkerActorId,
	parseSkillWorkerActorId,
	type EnvelopeInput,
	type EnvelopeRecord
} from '@jaensen/persistence-sqlite'

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
	directActors: [createSkillActorId('pdf')],
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

test('skill.request deterministically spawns worker and stores call mapping', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const result = await handler.activate({
		actor: makeActor({ skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({
			type: 'skill.request',
			payload: { intentId: 'intent-123', callId: 'call-1', request: 'Remember this', input: { text: 'hello' }, workerPolicy: 'ephemeral' }
		}),
		context: makeContext()
	})
	expect(result.nextState).toMatchObject({ calls: { 'call-1': expect.objectContaining({ callId: 'call-1' }) } })
	const outgoing = sentEnvelopes(result)[0]
	expect(outgoing.type).toBe('memory.run')
	expect(parseSkillWorkerActorId(outgoing.toActor)?.skillId).toBe('memory')
	expect(parseSkillWorkerActorId(outgoing.toActor)?.workerName).toContain('call-1')
	expect(outgoing.payload).toMatchObject({ callId: 'call-1' })
})

test('existing call reuses the same workerActorId', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const workerActorId = createStableWorkerActorId('memory', 'call-1-fixed')
	const result = await handler.activate({
		actor: makeActor({
			skillId: 'memory',
			workers: { [workerActorId]: { workerActorId, workerName: 'call-1-fixed', status: 'active', intentId: 'intent-123', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', workerActorId, status: 'active', intentId: 'intent-123', replyTo: createIntentActorId('intent-123') } }
		}),
		envelope: makeEnvelopeRecord({
			type: 'skill.request',
			payload: { intentId: 'intent-123', callId: 'call-1', request: 'Remember again', input: { text: 'hello' }, workerPolicy: 'ephemeral' }
		}),
		context: makeContext()
	})
	expect(sentEnvelopes(result)[0]?.toActor).toBe(workerActorId)
})

test('child skill.request preserves existing parent call linkage', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const result = await handler.activate({
		actor: makeActor({ skillId: 'memory', workers: {}, calls: {} }),
		envelope: makeEnvelopeRecord({
			fromActor: createWorkerActorId('pdf', 'worker-1'),
			type: 'skill.request',
			payload: { callId: 'child-1', parentCallId: 'parent-1', replyTo: createWorkerActorId('pdf', 'worker-1'), request: 'Nested', input: {} }
		}),
		context: makeContext()
	})
	expect(result.nextState).toMatchObject({ calls: { 'child-1': expect.objectContaining({ parentCallId: 'parent-1' }) } })
})

test('worker result routes back to owner with call ids', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const result = await handler.activate({
		actor: makeActor({
			skillId: 'memory',
			workers: { [createStableWorkerActorId('memory', 'worker-a')]: { workerActorId: createStableWorkerActorId('memory', 'worker-a'), workerName: 'worker-a', status: 'active', intentId: 'intent-123', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', workerActorId: createStableWorkerActorId('memory', 'worker-a'), status: 'active', intentId: 'intent-123', replyTo: createIntentActorId('intent-123') } }
		}),
		envelope: makeEnvelopeRecord({ type: 'skill.worker.result', fromActor: createStableWorkerActorId('memory', 'worker-a'), payload: { callId: 'call-1', result: { ok: true }, completed: true } }),
		context: makeContext()
	})
	expect(result.nextState).toMatchObject({ calls: { 'call-1': expect.objectContaining({ status: 'completed' }) } })
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: createIntentActorId('intent-123'),
		payload: expect.objectContaining({ callId: 'call-1', workerActorId: createStableWorkerActorId('memory', 'worker-a'), workerName: 'worker-a' })
	})
	expect(sentEnvelopes(result)[0].payload).not.toHaveProperty('parentCallId')
})

test('worker result routes child completion by payload.callId, not parentCallId', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const replyTo = createWorkerActorId('parent', 'worker-1')
	const workerActorId = createStableWorkerActorId('memory', 'worker-a')
	const result = await handler.activate({
		actor: makeActor({
			skillId: 'memory',
			workers: { [workerActorId]: { workerActorId, workerName: 'worker-a', status: 'active', intentId: 'intent-123', callId: 'child-call', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: {
				'child-call': {
					callId: 'child-call',
					workerActorId,
					status: 'active',
					intentId: 'intent-123',
					replyTo,
					parentCallId: 'parent-call'
				}
			}
		}),
		envelope: makeEnvelopeRecord({
			type: 'skill.worker.result',
			fromActor: workerActorId,
			payload: {
				callId: 'child-call',
				parentCallId: 'parent-call',
				result: { ok: true },
				completed: true
			}
		}),
		context: makeContext()
	})

	expect(result.nextState).toMatchObject({ calls: { 'child-call': expect.objectContaining({ status: 'completed' }) } })
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: replyTo,
		payload: expect.objectContaining({
			callId: 'child-call',
			parentCallId: 'parent-call'
		})
	})
})

test('mismatched payload.workerActorId is rejected', async () => {
	const handler = createSkillSupervisorHandler({ registry: createSkillRegistry([skill]) })
	const workerActorId = createStableWorkerActorId('memory', 'worker-a')
	await expect(handler.activate({
		actor: makeActor({
			skillId: 'memory',
			workers: { [workerActorId]: { workerActorId, workerName: 'worker-a', status: 'active', intentId: 'intent-123', callId: 'call-1', updatedAt: '2026-05-12T00:00:00.000Z' } },
			calls: { 'call-1': { callId: 'call-1', workerActorId, status: 'active', intentId: 'intent-123', replyTo: createIntentActorId('intent-123') } }
		}),
		envelope: makeEnvelopeRecord({ type: 'skill.worker.result', fromActor: workerActorId, payload: { workerActorId: createStableWorkerActorId('memory', 'other-worker'), callId: 'call-1', result: { ok: true }, completed: true } }),
		context: makeContext()
	})).rejects.toThrow(/payload\.workerActorId mismatch/i)
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
	return { id: createSkillActorId('memory'), kind: 'skill-supervisor', status: 'active' as const, state, version: 0, createdAt: '2026-05-12T00:00:00.000Z', updatedAt: '2026-05-12T00:00:00.000Z' }
}

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return { id: 'env-1', fromActor: createIntentActorId('default'), toActor: createSkillActorId('memory'), type: 'memory.remember', runId: 'corr-1', causedBy: null, payload: {}, status: 'queued', availableAt: '2026-05-12T00:00:00.000Z', attempts: 0, maxAttempts: 25, lockedBy: null, lockedUntil: null, lastError: null, createdAt: '2026-05-12T00:00:00.000Z', updatedAt: '2026-05-12T00:00:00.000Z', ...overrides }
}

function makeContext() {
	return {
		now: new Date('2026-05-12T00:00:00.000Z'),
		signal: new AbortController().signal,
		generateId: () => 'generated-id',
		contextSnapshotSeq: 0,
		queryContext: async () => [],
		makeEnvelope(input: { from: string; to: string; type: string; payload: unknown; runId?: string; causedBy?: string; availableAt?: Date }) {
			return { id: 'generated-envelope', fromActor: input.from, toActor: input.to, type: input.type, runId: input.runId ?? 'corr-1', causedBy: input.causedBy, payload: input.payload, availableAt: input.availableAt }
		}
	}
}

function sentEnvelopes(result: { commands: Array<{ type: string; envelope?: EnvelopeInput }> }): EnvelopeInput[] {
	return result.commands.filter((command): command is { type: 'send_envelope'; envelope: EnvelopeInput } => command.type === 'send_envelope' && Boolean(command.envelope)).map((command) => command.envelope)
}