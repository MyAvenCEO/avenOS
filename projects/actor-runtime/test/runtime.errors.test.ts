import { expect, test } from 'bun:test'

import { ConcurrencyError } from '../../persistence-sqlite/src/errors'

import { createActorRuntime } from '../src/create-actor-runtime'
import { RuntimeCommitError } from '../src/errors'
import { FakePersistence } from './helpers'

test('fails message when handler missing', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/missing', kind: 'intent', state: {} })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	await runtime.enqueue({
		id: 'env-missing',
		fromActor: 'dispatcher/root',
		toActor: 'intent/missing',
		type: 'message',
		correlationId: 'corr-missing',
		payload: null
	})

	await expect(runtime.tick()).resolves.toBe('processed')

	const row = persistence.envelopes.get('env-missing')
	expect(row?.status).toBe('queued')
	expect(row?.lastError).toBe('No actor handler registered for kind: intent')
})

test('retries message when handler throws', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/throw', kind: 'intent', state: {} })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate() {
			throw new Error('boom')
		}
	})

	await runtime.enqueue({
		id: 'env-throw',
		fromActor: 'dispatcher/root',
		toActor: 'intent/throw',
		type: 'message',
		correlationId: 'corr-throw',
		payload: null
	})

	await runtime.tick()

	const row = persistence.envelopes.get('env-throw')
	expect(row?.status).toBe('queued')
	expect(row?.lastError).toBe('boom')
	expect(row?.attempts).toBe(1)
})

test('fails message when handler returns a bad result', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/bad-result', kind: 'intent', state: {} })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate() {
			return {} as never
		}
	})

	await runtime.enqueue({
		id: 'env-bad-result',
		fromActor: 'dispatcher/root',
		toActor: 'intent/bad-result',
		type: 'message',
		correlationId: 'corr-bad-result',
		payload: null
	})

	await runtime.tick()

	const row = persistence.envelopes.get('env-bad-result')
	expect(row?.status).toBe('queued')
	expect(row?.lastError).toBe('Actor activation result must include state')
})

test('throws RuntimeCommitError after failActivation when commit conflicts', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/conflict', kind: 'intent', state: {} })
	persistence.commitError = new ConcurrencyError('Actor intent/conflict version mismatch: expected 0, got 1')

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate() {
			return { state: { done: true } }
		}
	})

	await runtime.enqueue({
		id: 'env-conflict',
		fromActor: 'dispatcher/root',
		toActor: 'intent/conflict',
		type: 'message',
		correlationId: 'corr-conflict',
		payload: null
	})

	await expect(runtime.tick()).rejects.toBeInstanceOf(RuntimeCommitError)

	const row = persistence.envelopes.get('env-conflict')
	expect(row?.status).toBe('queued')
	expect(row?.lastError).toContain('version mismatch')
})