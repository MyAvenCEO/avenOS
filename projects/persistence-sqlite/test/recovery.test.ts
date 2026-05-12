import { expect, test } from 'bun:test'

import { SqlitePersistence } from '../src/sqlite-persistence'

test('failActivation requeues work with retry metadata and clears locks', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.enqueue({
		id: 'env-fail',
		fromActor: 'dispatcher/root',
		toActor: 'intent/failure-case',
		type: 'message',
		correlationId: 'corr-fail',
		payload: { hello: 'world' }
	})

	await persistence.claimNext({
		workerId: 'worker-fail',
		leaseMs: 30_000,
		now: new Date('2026-05-12T00:00:00.000Z')
	})

	await persistence.failActivation({
		workerId: 'worker-fail',
		envelopeId: 'env-fail',
		error: 'boom',
		retryAt: new Date('2026-05-12T00:05:00.000Z'),
		now: new Date('2026-05-12T00:01:00.000Z')
	})

	const db = persistence.db
	const row = db.prepare('SELECT status, available_at, locked_by, locked_until, last_error FROM envelopes WHERE id = ?').get('env-fail') as {
		status: string
		available_at: string
		locked_by: string | null
		locked_until: string | null
		last_error: string | null
	}
	expect(row.status).toBe('queued')
	expect(row.available_at).toBe('2026-05-12T00:05:00.000Z')
	expect(row.locked_by).toBeNull()
	expect(row.locked_until).toBeNull()
	expect(row.last_error).toBe('boom')

	const lockCount = db.prepare('SELECT COUNT(*) AS count FROM actor_locks').get() as { count: number }
	expect(lockCount.count).toBe(0)
})

test('failActivation marks dead intent envelopes as failed intent state and emits lifecycle event', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({
		id: 'intent/failure-case',
		kind: 'intent',
		state: {
			intentId: 'failure-case',
			title: 'Failure case',
			goal: 'Handle failure',
			status: 'active',
			summary: 'Working',
			pendingSkillCalls: { call1: { callId: 'call1', skillId: 'memory', request: 'do it', createdAt: '2026-05-12T00:00:00.000Z' } }
		}
	})

	await persistence.enqueue({
		id: 'env-dead-intent',
		fromActor: 'dispatcher/root',
		toActor: 'intent/failure-case',
		type: 'message',
		correlationId: 'corr-dead-intent',
		payload: { hello: 'world' },
		maxAttempts: 1
	})

	await persistence.claimNext({
		workerId: 'worker-fail',
		leaseMs: 30_000,
		now: new Date('2026-05-12T00:00:00.000Z')
	})

	await persistence.failActivation({
		workerId: 'worker-fail',
		envelopeId: 'env-dead-intent',
		error: 'boom-dead',
		now: new Date('2026-05-12T00:01:00.000Z')
	})

	const actor = await persistence.getActor('intent/failure-case')
	expect(actor?.state).toEqual({
		intentId: 'failure-case',
		title: 'Failure case',
		goal: 'Handle failure',
		status: 'failed',
		summary: 'boom-dead',
		pendingSkillCalls: {}
	})

	const events = await persistence.listStreamEvents({ scope: 'intent/failure-case' })
	expect(events.some((event) => event.type === 'runtime.envelope.failed')).toBe(true)
	expect(events).toContainEqual(
		expect.objectContaining({
			type: 'intent.status_changed',
			payload: expect.objectContaining({
				intentId: 'failure-case',
				status: 'failed',
				summary: 'boom-dead'
			})
		})
	)
})

test('releaseExpiredLocks requeues stale envelopes and dead-letters exhausted ones', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.enqueue({
		id: 'env-stale',
		fromActor: 'dispatcher/root',
		toActor: 'intent/stale',
		type: 'message',
		correlationId: 'corr-stale',
		payload: { stale: true }
	})
	await persistence.enqueue({
		id: 'env-dead',
		fromActor: 'dispatcher/root',
		toActor: 'intent/dead',
		type: 'message',
		correlationId: 'corr-dead',
		payload: { dead: true },
		maxAttempts: 1
	})

	await persistence.claimNext({
		workerId: 'worker-stale',
		leaseMs: 1_000,
		now: new Date('2026-05-12T00:00:00.000Z')
	})
	await persistence.claimNext({
		workerId: 'worker-dead',
		leaseMs: 1_000,
		now: new Date('2026-05-12T00:00:00.000Z')
	})

	const released = await persistence.releaseExpiredLocks(new Date('2026-05-12T00:00:02.000Z'))
	expect(released).toBe(2)

	const db = persistence.db
	const stale = db.prepare('SELECT status, locked_by, locked_until FROM envelopes WHERE id = ?').get('env-stale') as {
		status: string
		locked_by: string | null
		locked_until: string | null
	}
	const dead = db.prepare('SELECT status FROM envelopes WHERE id = ?').get('env-dead') as { status: string }
	const lockCount = db.prepare('SELECT COUNT(*) AS count FROM actor_locks').get() as { count: number }

	expect(stale.status).toBe('queued')
	expect(stale.locked_by).toBeNull()
	expect(stale.locked_until).toBeNull()
	expect(dead.status).toBe('dead')
	expect(lockCount.count).toBe(0)
})