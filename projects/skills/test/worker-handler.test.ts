import { expect, test } from 'bun:test'
import {
	createSkillActorId,
	createWorkerActorId,
	parseSkillWorkerActorId,
	type EnvelopeInput,
	type EnvelopeRecord
} from '@jaensen/persistence-sqlite'

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
	directActors: [createSkillActorId('files')],
	frontmatter: { id: 'memory', description: 'Memory skill' },
	body: '# Memory',
	bodyHash: 'hash-memory',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('worker sends skill.worker.result to supervisor', async () => {
	const actorId = createWorkerActorId('memory', 'topic-jaensen-architecture')
	const workerName = parseSkillWorkerActorId(actorId)?.workerName
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
		actor: makeActor(actorId, {}),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		fromActor: actorId,
		toActor: createSkillActorId('memory'),
		type: 'skill.worker.result',
		runId: 'corr-1',
		causedBy: 'env-1',
		payload: {
			workerActorId: actorId,
			workerName,
			intentId: 'intent-123',
			callId: 'call-1',
			result: { stored: true },
			completed: true
		}
	})
	expect((sentEnvelopes(result)[0].payload as { parentCallId?: string }).parentCallId).toBeUndefined()
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
		actor: makeActor(createWorkerActorId('memory', 'job-01j'), {}),
		envelope: makeEnvelopeRecord({ payload: { initialState: { seeded: true } } }),
		context: makeContext()
	})

	await handler.activate({
		actor: makeActor(createWorkerActorId('memory', 'job-01j'), { persisted: true }),
		envelope: makeEnvelopeRecord({ payload: { initialState: { seeded: false } } }),
		context: makeContext()
	})

	expect(seenStates).toEqual([{ seeded: true }, { persisted: true }])
})

test('worker rejects empty active-call responses when it returns only state for a call', async () => {
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

	await expect(
		handler.activate({
			actor: makeActor(createWorkerActorId('memory', 'call-lookup-1'), {}),
			envelope: makeEnvelopeRecord({
				toActor: createWorkerActorId('memory', 'call-lookup-1'),
				payload: { intentId: 'intent-123', callId: 'call-lookup-1' }
			}),
			context: makeContext()
		})
	).rejects.toThrow(/no result and no actions/i)
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
			actor: makeActor(createWorkerActorId('missing', 'job-01j'), {}),
			envelope: makeEnvelopeRecord({ toActor: createWorkerActorId('missing', 'job-01j') }),
			context: makeContext()
		})
	).rejects.toThrow(new SkillNotFoundError('missing'))
})

test('worker call_skill maps to skill.request', async () => {
	const actorId = createWorkerActorId('memory', 'topic-jaensen-architecture')
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([
			skill,
			{ ...skill, id: 'files', path: 'files/SKILL.md', directActors: [], frontmatter: { id: 'files', description: 'Files skill' } }
		]),
		brain: {
			async run() {
				return {
					state: {},
					actions: [{ type: 'call_skill', to: createSkillActorId('files'), callId: 'call-2', request: 'Read file', payload: { path: 'a.txt' } }],
					completed: false
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor(actorId, {}),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'call-1' } }),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: createSkillActorId('files'),
		type: 'skill.request',
		payload: {
			callId: 'call-2',
			request: 'Read file',
			input: { path: 'a.txt' },
			replyTo: actorId,
			intentId: 'intent-123',
			parentCallId: 'call-1'
		}
	})
})

test('worker delegation does not also emit skill.worker.result for the parent call', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([
			skill,
			{ ...skill, id: 'files', path: 'files/SKILL.md', directActors: [], frontmatter: { id: 'files', description: 'Files skill' } }
		]),
		brain: {
			async run() {
				return {
					state: { waitingOnChild: true },
					actions: [{ type: 'call_skill', to: createSkillActorId('files'), callId: 'child-call-1', request: 'Read file', payload: { path: 'a.txt' } }],
					completed: false
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor(createWorkerActorId('memory', 'topic-jaensen-architecture'), {}),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'parent-call-1' } }),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: createSkillActorId('files'),
		type: 'skill.request',
		payload: expect.objectContaining({ parentCallId: 'parent-call-1', callId: 'child-call-1' })
	})
})

test('worker rejects mixed delegation and completion payloads loudly', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([
			skill,
			{ ...skill, id: 'files', path: 'files/SKILL.md', directActors: [], frontmatter: { id: 'files', description: 'Files skill' } }
		]),
		brain: {
			async run() {
				return {
					state: {},
					result: { invalid: true },
					completed: true,
					actions: [{ type: 'call_skill', to: createSkillActorId('files'), callId: 'child-call-1', request: 'Read file', payload: {} }]
				}
			}
		}
	})

	await expect(handler.activate({
		actor: makeActor(createWorkerActorId('memory', 'topic-jaensen-architecture'), {}),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'parent-call-1' } }),
		context: makeContext()
	})).rejects.toThrow(/may not include both actions and result/i)
})

	test('worker completing a child skill.result routes completion to parent call id', async () => {
	const actorId = createWorkerActorId('memory', 'topic-jaensen-architecture')
	const workerName = parseSkillWorkerActorId(actorId)?.workerName
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async run() {
				return {
					state: { done: true },
					result: { stored: true },
					completed: true
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor(actorId, {
			callId: 'parent-call-1',
			intentId: 'intent-123'
		}),
		envelope: makeEnvelopeRecord({
			type: 'skill.result',
			payload: {
				intentId: 'intent-123',
				callId: 'child-call-1',
				parentCallId: 'parent-call-1',
				result: { ok: true }
			}
		}),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: createSkillActorId('memory'),
		type: 'skill.worker.result',
		payload: expect.objectContaining({
			workerActorId: actorId,
			workerName,
			callId: 'parent-call-1',
			intentId: 'intent-123',
			result: { stored: true },
			completed: true
		})
	})
})

	test('worker final context append after child result stays scoped to parent call', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async run() {
				return {
					state: { done: true },
					result: { stored: true },
					completed: true
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor(createWorkerActorId('memory', 'topic-jaensen-architecture'), {
			waitingOnChild: true,
			callId: 'parent-call',
		}),
		envelope: makeEnvelopeRecord({
			type: 'skill.result',
			payload: {
				intentId: 'intent-123',
				callId: 'child-call',
				parentCallId: 'parent-call',
				result: { ok: true }
			}
		}),
		context: makeContext()
	})

	expect(result.contextAppends).toEqual([
		expect.objectContaining({
			callId: 'parent-call'
		})
	])
	expect(sentEnvelopes(result)[0]).toMatchObject({
		payload: expect.objectContaining({
			callId: 'parent-call'
		})
	})
})

test('worker normal run completion uses local callId even when parentCallId exists', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([skill]),
		brain: {
			async run() {
				return {
					state: { done: true },
					result: { stored: true },
					completed: true
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor(createWorkerActorId('memory', 'topic-jaensen-architecture'), {}),
		envelope: makeEnvelopeRecord({
			type: 'memory.remember',
			payload: {
				intentId: 'intent-123',
				callId: 'child-call-1',
				parentCallId: 'parent-call-1'
			}
		}),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		payload: expect.objectContaining({ callId: 'child-call-1' })
	})
})

test('worker call_skill rejects unlisted target', async () => {
	const handler = createSkillWorkerHandler({
		registry: createSkillRegistry([{ ...skill, directActors: [] }]),
		brain: {
			async run() {
				return {
					state: {},
					actions: [{ type: 'call_skill', to: createSkillActorId('files'), callId: 'call-2', request: 'Read file', payload: {} }],
					completed: false
				}
			}
		}
	})

	await expect(handler.activate({
		actor: makeActor(createWorkerActorId('memory', 'topic-jaensen-architecture'), {}),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})).rejects.toThrow(/may not call unlisted actor aven\/skills\/files/)
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
		fromActor: createSkillActorId('memory'),
		toActor: createWorkerActorId('memory', 'topic-jaensen-architecture'),
		type: 'memory.remember',
		runId: 'corr-1',
		causedBy: null,
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
		signal: new AbortController().signal,
		generateId() {
			return 'generated-id'
		},
		contextSnapshotSeq: 0,
		async queryContext() {
			return []
		},
		makeEnvelope(input: {
			from: string
			to: string
			type: string
			payload: unknown
			runId?: string
			causedBy?: string
			availableAt?: Date
		}) {
			return {
				id: 'generated-envelope',
				fromActor: input.from,
				toActor: input.to,
				type: input.type,
				runId: input.runId ?? 'corr-1',
				causedBy: input.causedBy,
				payload: input.payload,
				availableAt: input.availableAt
			}
		}
	}
}

function sentEnvelopes(result: { commands: Array<{ type: string; envelope?: EnvelopeInput }> }): EnvelopeInput[] {
	return result.commands
		.filter((command): command is { type: 'send_envelope'; envelope: EnvelopeInput } => command.type === 'send_envelope' && Boolean(command.envelope))
		.map((command) => command.envelope)
}