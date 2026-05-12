import { expect, test } from 'bun:test'

import { createActorRuntime } from '../src/create-actor-runtime'
import { FakePersistence } from './helpers'

test('processes one envelope successfully', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/example', kind: 'intent', state: { step: 'queued' } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor }) {
			return { state: actor.state }
		}
	})

	await runtime.enqueue({
		id: 'env-1',
		fromActor: 'dispatcher/root',
		toActor: 'intent/example',
		type: 'message',
		correlationId: 'corr-1',
		payload: { ok: true }
	})

	await expect(runtime.tick()).resolves.toBe('processed')

	expect(persistence.envelopes.get('env-1')?.status).toBe('done')
})

test('preserves actor state when handler returns same state', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/same', kind: 'intent', state: { phase: 'same' } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor }) {
			return { state: actor.state }
		}
	})

	await runtime.enqueue({
		id: 'env-same',
		fromActor: 'dispatcher/root',
		toActor: 'intent/same',
		type: 'message',
		correlationId: 'corr-same',
		payload: null
	})

	await runtime.tick()

	const actor = await persistence.getActor('intent/same')
	expect(actor?.state).toEqual({ phase: 'same' })
	expect(actor?.version).toBe(1)
})

test('persists updated actor state, enqueues outgoing envelopes, and records handler events', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/update', kind: 'intent', state: { phase: 'queued' } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor, envelope, context }) {
			return {
				state: { phase: 'processed' },
				events: [
					{
						id: 'evt-handler',
						actorId: actor.id,
						envelopeId: envelope.id,
						eventType: 'intent.processed',
						event: { ok: true }
					}
				],
				outgoing: [
					context.makeEnvelope({
						from: actor.id,
						to: 'skill/extract',
						type: 'extract-request',
						payload: { extract: true }
					})
				]
			}
		}
	})

	await runtime.enqueue({
		id: 'env-update',
		fromActor: 'dispatcher/root',
		toActor: 'intent/update',
		type: 'message',
		correlationId: 'corr-update',
		payload: { work: true }
	})

	await runtime.tick()

	const actor = await persistence.getActor('intent/update')
	expect(actor?.state).toEqual({ phase: 'processed' })

	const events = persistence.events.filter((event) => event.actorId === 'intent/update')
	expect(events).toHaveLength(2)
	expect(events.some((event) => event.id === 'evt-handler' && event.eventType === 'intent.processed')).toBe(true)
	expect(events.some((event) => event.eventType === 'runtime.activation.completed')).toBe(true)

	const outgoing = [...persistence.envelopes.values()].filter((envelope) => envelope.id !== 'env-update')

	expect(outgoing).toHaveLength(1)
	expect(outgoing[0]).toMatchObject({
		fromActor: 'intent/update',
		toActor: 'skill/extract',
		type: 'extract-request',
		correlationId: 'corr-update',
		causationId: 'env-update',
		status: 'queued'
	})
})

test('runUntilIdle stops when idle', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/idle', kind: 'intent', state: { count: 0 } })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ actor }) {
			return { state: actor.state }
		}
	})

	await runtime.enqueue({
		id: 'env-idle',
		fromActor: 'dispatcher/root',
		toActor: 'intent/idle',
		type: 'message',
		correlationId: 'corr-idle',
		payload: null
	})

	await expect(runtime.runUntilIdle()).resolves.toBe(1)
	await expect(runtime.tick()).resolves.toBe('idle')
})

test('runUntilIdle respects maxTicks', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/max', kind: 'intent', state: { count: 0 } })

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
				state: { count: count + 1 },
				outgoing: count === 0
					? [
							context.makeEnvelope({
								from: actor.id,
								to: actor.id,
								type: 'message',
								payload: { count: count + 1 }
							})
						]
					: []
			}
		}
	})

	await runtime.enqueue({
		id: 'env-max',
		fromActor: 'dispatcher/root',
		toActor: 'intent/max',
		type: 'message',
		correlationId: 'corr-max',
		payload: { count: 0 }
	})

	await expect(runtime.runUntilIdle(1)).resolves.toBe(1)

	const queued = [...persistence.envelopes.values()].filter((envelope) => envelope.status === 'queued')
	expect(queued).toHaveLength(1)
})