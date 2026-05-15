import { expect, test } from 'bun:test'
import { DISPATCHER_ACTOR_ID, createIntentActorId, createSkillActorId, createWorkerActorId } from '../../persistence-sqlite/src/actor-id'

import { createActorRuntime } from '../src/create-actor-runtime'
import { FakePersistence } from './helpers'

test('processes one envelope successfully', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: createIntentActorId('example'), kind: 'intent', state: { step: 'queued' } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor }) {
			return { nextState: actor.state, contextAppends: [], commands: [] }
		}
	})

	await runtime.enqueue({
		id: 'env-1',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('example'),
		type: 'message',
		runId: 'corr-1',
		payload: { ok: true }
	})

	await expect(runtime.tick()).resolves.toBe('processed')

	expect(persistence.envelopes.get('env-1')?.status).toBe('done')
})

test('preserves actor state when handler returns same state', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: createIntentActorId('same'), kind: 'intent', state: { phase: 'same' } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor }) {
			return { nextState: actor.state, contextAppends: [], commands: [] }
		}
	})

	await runtime.enqueue({
		id: 'env-same',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('same'),
		type: 'message',
		runId: 'corr-same',
		payload: null
	})

	await runtime.tick()

	const actor = await persistence.getActor(createIntentActorId('same'))
	expect(actor?.state).toEqual({ phase: 'same' })
	expect(actor?.version).toBe(1)
})

test('persists updated actor state, enqueues outgoing envelopes, and records handler events', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: createIntentActorId('update'), kind: 'intent', state: { phase: 'queued' } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor, envelope, context }) {
			return {
				nextState: { phase: 'processed' },
				contextAppends: [],
				commands: [
					{
						type: 'emit_event',
						event: {
							id: 'evt-handler',
							actorId: actor.id,
							envelopeId: envelope.id,
							eventType: 'intent.processed',
							event: { ok: true }
						}
					},
					{ type: 'send_envelope', envelope: context.makeEnvelope({
						from: actor.id,
						to: createSkillActorId('extract'),
						type: 'extract-request',
						payload: { extract: true }
					}) }
				]
			}
		}
	})

	await runtime.enqueue({
		id: 'env-update',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('update'),
		type: 'message',
		runId: 'corr-update',
		payload: { work: true }
	})

	await runtime.tick()

	const actor = await persistence.getActor(createIntentActorId('update'))
	expect(actor?.state).toEqual({ phase: 'processed' })

	const events = persistence.events.filter((event) => event.actorId === createIntentActorId('update'))
	expect(events).toHaveLength(2)
	expect(events.some((event) => event.id === 'evt-handler' && event.eventType === 'intent.processed')).toBe(true)
	expect(events.some((event) => event.eventType === 'runtime.activation.completed')).toBe(true)

	const outgoing = [...persistence.envelopes.values()].filter((envelope) => envelope.id !== 'env-update')

	expect(outgoing).toHaveLength(1)
	expect(outgoing[0]).toMatchObject({
		fromActor: createIntentActorId('update'),
		toActor: createSkillActorId('extract'),
		type: 'extract-request',
		runId: 'corr-update',
		causedBy: 'env-update',
		status: 'queued'
	})
})

test('runUntilIdle stops when idle', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: createIntentActorId('idle'), kind: 'intent', state: { count: 0 } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor }) {
			return { nextState: actor.state, contextAppends: [], commands: [] }
		}
	})

	await runtime.enqueue({
		id: 'env-idle',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('idle'),
		type: 'message',
		runId: 'corr-idle',
		payload: null
	})

	await expect(runtime.runUntilIdle()).resolves.toBe(1)
	await expect(runtime.tick()).resolves.toBe('idle')
})

test('runUntilIdle respects maxTicks', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: createIntentActorId('max'), kind: 'intent', state: { count: 0 } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor, context }) {
			const count = (actor.state as { count: number }).count
			return {
				nextState: { count: count + 1 },
				contextAppends: [],
				commands: count === 0
					? [
							{ type: 'send_envelope', envelope: context.makeEnvelope({
								from: actor.id,
								to: actor.id,
								type: 'message',
								payload: { count: count + 1 }
							}) }
						]
					: []
			}
		}
	})

	await runtime.enqueue({
		id: 'env-max',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('max'),
		type: 'message',
		runId: 'corr-max',
		payload: { count: 0 }
	})

	await expect(runtime.runUntilIdle(1)).resolves.toBe(1)

	const queued = [...persistence.envelopes.values()].filter((envelope) => envelope.status === 'queued')
	expect(queued).toHaveLength(1)
})

test('debug registry tracks actor state and message events', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: createIntentActorId('debug'), kind: 'intent', state: { ok: true } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-debug',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor }) {
			return { nextState: actor.state, contextAppends: [], commands: [] }
		}
	})

	await runtime.enqueue({
		id: 'env-debug',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('debug'),
		type: 'intent.start',
		runId: 'corr-debug',
		payload: { ok: true }
	})

	await runtime.tick()

	const snapshot = runtime.debug.getSnapshot()
	const actor = snapshot.actors.find((item) => item.id === createIntentActorId('debug'))
	expect(actor).toBeDefined()
	expect(actor?.status).toBe('idle')

	const events = runtime.debug.listEvents()
	expect(events.some((event) => event.event.type === 'MessageSent')).toBe(true)
	expect(events.some((event) => event.event.type === 'ActorStateChanged')).toBe(true)
	})

test('recordTrace persists actor IO traces to the stream store', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	const workerActorId = createWorkerActorId('memory', 'topic-jaensen-architecture')
	await persistence.upsertActor({ id: workerActorId, kind: 'skill-worker', state: {} })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-trace',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.debug.recordTrace(workerActorId, {
		kind: 'task',
		label: 'worker',
		inputSummary: 'analyze file',
		outputSummary: 'done',
		cwd: '/tmp',
		at: '2026-05-12T00:00:00.000Z'
	})

	await new Promise((resolve) => setTimeout(resolve, 0))

	expect(persistence.appendedEvents.some((event) => event.type === 'actor.io.task')).toBe(true)
	expect(persistence.appendedEvents.some((event) => event.actorId === workerActorId)).toBe(true)
})