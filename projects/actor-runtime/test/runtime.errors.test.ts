import { expect, test } from 'bun:test'

import { ConcurrencyError } from '../../persistence-sqlite/src/errors'

import { createActorRuntime } from '../src/create-actor-runtime'
import { RuntimeActivationTimeoutError, RuntimeCommitError } from '../src/errors'
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

test('retries message when handler times out after 60s', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/slow', kind: 'intent', state: {} })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		activationTimeoutMs: 60_000,
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate() {
			await new Promise((resolve) => setTimeout(resolve, 61_000))
			return { state: { done: true } }
		}
	})

	await runtime.enqueue({
		id: 'env-slow',
		fromActor: 'dispatcher/root',
		toActor: 'intent/slow',
		type: 'message',
		correlationId: 'corr-slow',
		payload: null
	})

	await expect(runtime.tick()).resolves.toBe('processed')

	const row = persistence.envelopes.get('env-slow')
	expect(row?.status).toBe('queued')
	expect(row?.attempts).toBe(1)
	expect(typeof row?.lastError).toBe('string')
	expect(row?.lastError).toContain('did not produce a valid response within 60000ms')
	expect(new RuntimeActivationTimeoutError('x').name).toBe('RuntimeActivationTimeoutError')
}, 70_000)

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

test('timeout aborts signal-aware activations', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/abortable', kind: 'intent', state: {} })
	let aborted = false

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		activationTimeoutMs: 50,
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	runtime.register({
		kind: 'intent',
		async activate({ context }) {
			await new Promise((_, reject) => {
				context.signal.addEventListener('abort', () => {
					aborted = true
					reject(context.signal.reason)
				}, { once: true })
			})
			return { state: { done: true } }
		}
	})

	await runtime.enqueue({
		id: 'env-abortable',
		fromActor: 'dispatcher/root',
		toActor: 'intent/abortable',
		type: 'message',
		correlationId: 'corr-abortable',
		payload: null
	})

	await expect(runtime.tick()).resolves.toBe('processed')
	expect(aborted).toBe(true)
	expect(persistence.envelopes.get('env-abortable')?.lastError).toContain('did not produce a valid response within 50ms')
})

test('claim lease is padded to cover activation timeout and cleanup window', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/leasey', kind: 'intent', state: {} })

	const now = new Date('2026-05-12T00:00:00.000Z')
	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		leaseMs: 100,
		activationTimeoutMs: 500,
		activationCleanupMs: 200,
		clock: () => now
	})

	runtime.register({
		kind: 'intent',
		async activate() {
			return { state: {} }
		}
	})

	await runtime.enqueue({
		id: 'env-leasey',
		fromActor: 'dispatcher/root',
		toActor: 'intent/leasey',
		type: 'message',
		correlationId: 'corr-leasey',
		payload: null
	})

	await runtime.tick()
	const row = persistence.envelopes.get('env-leasey')
	expect(row?.updatedAt).toBe(now.toISOString())
	expect(row?.status).toBe('done')
	expect(persistence.claimedLeaseMs).toBe(700)
})

test('runUntilIdle continues after commit conflicts', async () => {
	const persistence = new FakePersistence()
	await persistence.migrate()
	await persistence.upsertActor({ id: 'intent/conflict-1', kind: 'intent', state: {} })
	await persistence.upsertActor({ id: 'intent/conflict-2', kind: 'intent', state: {} })

	const runtime = createActorRuntime({
		persistence,
		workerId: 'worker-1',
		clock: () => new Date('2026-05-12T00:00:00.000Z')
	})

	let first = true
	runtime.register({
		kind: 'intent',
		async activate() {
			if (first) {
				first = false
				persistence.commitError = new ConcurrencyError('Actor intent/conflict-1 version mismatch: expected 0, got 1')
			} else {
				persistence.commitError = null
			}
			return { state: { done: true } }
		}
	})

	await runtime.enqueue({
		id: 'env-conflict-1',
		fromActor: 'dispatcher/root',
		toActor: 'intent/conflict-1',
		type: 'message',
		correlationId: 'corr-conflict-1',
		payload: null
	})
	await runtime.enqueue({
		id: 'env-conflict-2',
		fromActor: 'dispatcher/root',
		toActor: 'intent/conflict-2',
		type: 'message',
		correlationId: 'corr-conflict-2',
		payload: null
	})

	const processed = await runtime.runUntilIdle(3)
	expect(processed).toBeGreaterThanOrEqual(2)
	expect(['queued', 'done']).toContain(persistence.envelopes.get('env-conflict-1')?.status ?? '')
	expect(persistence.envelopes.get('env-conflict-1')?.lockedBy).toBeNull()
	expect(persistence.envelopes.get('env-conflict-2')?.status).toBe('done')
})