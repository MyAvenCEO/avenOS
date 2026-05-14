import { expect, test } from 'bun:test'
import type { EnvelopeInput, EnvelopeRecord } from '@jaensen/persistence-sqlite'

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
	directActors: ['skills/files'],
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
		actor: makeActor('skills/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		fromActor: 'skills/memory/topic-jaensen-architecture',
		toActor: 'skills/memory',
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
		actor: makeActor('skills/memory/job-01J', {}),
		envelope: makeEnvelopeRecord({ payload: { initialState: { seeded: true } } }),
		context: makeContext()
	})

	await handler.activate({
		actor: makeActor('skills/memory/job-01J', { persisted: true }),
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
			actor: makeActor('skills/memory/call-lookup-1', {}),
			envelope: makeEnvelopeRecord({
				toActor: 'skills/memory/call-lookup-1',
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
			actor: makeActor('skills/missing/job-01J', {}),
			envelope: makeEnvelopeRecord({ toActor: 'skills/missing/job-01J' }),
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
					actions: [{ type: 'call_skill', to: 'skills/files', callId: 'call-2', request: 'Read file', payload: { path: 'a.txt' } }],
					completed: false
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skills/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'call-1' } }),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: 'skills/files',
		type: 'skill.request',
		payload: {
			callId: 'call-2',
			request: 'Read file',
			input: { path: 'a.txt' },
			replyTo: 'skills/memory/topic-jaensen-architecture',
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
					actions: [{ type: 'call_skill', to: 'skills/files', callId: 'child-call-1', request: 'Read file', payload: { path: 'a.txt' } }],
					completed: false
				}
			}
		}
	})

	const result = await handler.activate({
		actor: makeActor('skills/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'parent-call-1' } }),
		context: makeContext()
	})

	expect(sentEnvelopes(result)).toHaveLength(1)
	expect(sentEnvelopes(result)[0]).toMatchObject({
		toActor: 'skills/files',
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
					actions: [{ type: 'call_skill', to: 'skills/files', callId: 'child-call-1', request: 'Read file', payload: {} }]
				}
			}
		}
	})

	await expect(handler.activate({
		actor: makeActor('skills/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord({ payload: { intentId: 'intent-123', callId: 'parent-call-1' } }),
		context: makeContext()
	})).rejects.toThrow(/may not include call_skill actions and also complete/i)
})

test('worker completing a child skill.result routes completion to parent call id', async () => {
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
		actor: makeActor('skills/memory/topic-jaensen-architecture', {
			callId: 'parent-call-1',
			rootCallId: 'parent-call-1',
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
		toActor: 'skills/memory',
		type: 'skill.worker.result',
		payload: expect.objectContaining({
			workerId: 'topic-jaensen-architecture',
			callId: 'parent-call-1',
			rootCallId: 'parent-call-1',
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
		actor: makeActor('skills/memory/topic-jaensen-architecture', {
			waitingOnChild: true,
			callId: 'parent-call',
			rootCallId: 'parent-call'
		}),
		envelope: makeEnvelopeRecord({
			type: 'skill.result',
			payload: {
				intentId: 'intent-123',
				callId: 'child-call',
				parentCallId: 'parent-call',
				rootCallId: 'parent-call',
				result: { ok: true }
			}
		}),
		context: makeContext()
	})

	expect(result.contextAppends).toEqual([
		expect.objectContaining({
			scope: { type: 'call', callId: 'parent-call', parentCallId: undefined, rootCallId: 'parent-call' }
		})
	])
	expect(sentEnvelopes(result)[0]).toMatchObject({
		payload: expect.objectContaining({
			callId: 'parent-call',
			rootCallId: 'parent-call'
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
		actor: makeActor('skills/memory/topic-jaensen-architecture', {}),
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
					actions: [{ type: 'call_skill', to: 'skills/files', callId: 'call-2', request: 'Read file', payload: {} }],
					completed: false
				}
			}
		}
	})

	await expect(handler.activate({
		actor: makeActor('skills/memory/topic-jaensen-architecture', {}),
		envelope: makeEnvelopeRecord(),
		context: makeContext()
	})).rejects.toThrow(/may not call unlisted actor skills\/files/)
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
		fromActor: 'skills/memory',
		toActor: 'skills/memory/topic-jaensen-architecture',
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

function sentEnvelopes(result: { commands: Array<{ type: string; envelope?: EnvelopeInput }> }): EnvelopeInput[] {
	return result.commands
		.filter((command): command is { type: 'send_envelope'; envelope: EnvelopeInput } => command.type === 'send_envelope' && Boolean(command.envelope))
		.map((command) => command.envelope)
}