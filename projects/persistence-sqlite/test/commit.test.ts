import { expect, test } from 'bun:test'

import { SqlitePersistence } from '../src/sqlite-persistence'

test('commitActivation updates actor state, appends events, and enqueues outgoing envelopes atomically', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({
		id: 'intents/invoice-7',
		kind: 'intent',
		state: { phase: 'queued' }
	})

	await persistence.enqueue({
		id: 'env-in',
		fromActor: 'dispatcher',
		toActor: 'intents/invoice-7',
		type: 'message',
		correlationId: 'corr-in',
		payload: { invoiceId: 7 }
	})

	const claimed = await persistence.claimNext({
		workerId: 'worker-1',
		leaseMs: 60_000,
		now: new Date('2026-05-12T00:00:00.000Z')
	})

	expect(claimed?.actor.version).toBe(0)

	await persistence.commitActivation({
		workerId: 'worker-1',
		envelopeId: 'env-in',
		actorId: 'intents/invoice-7',
		expectedActorVersion: 0,
		newActorState: { phase: 'processed' },
		events: [
			{
				id: 'evt-1',
				actorId: 'intents/invoice-7',
				eventType: 'processed',
				event: { ok: true }
			}
		],
		outgoing: [
			{
				id: 'env-out',
				fromActor: 'intents/invoice-7',
				toActor: 'skills/extract',
				type: 'extract-request',
				correlationId: 'corr-out',
				causationId: 'env-in',
				payload: { archiveKey: 'archive-7' }
			}
		],
		now: new Date('2026-05-12T00:01:00.000Z')
	})

	const actor = await persistence.getActor('intents/invoice-7')
	expect(actor?.state).toEqual({ phase: 'processed' })
	expect(actor?.version).toBe(1)

	const db = persistence.db
	const envelopeStatus = db.prepare('SELECT status, locked_by, locked_until FROM envelopes WHERE id = ?').get('env-in') as {
		status: string
		locked_by: string | null
		locked_until: string | null
	}
	expect(envelopeStatus.status).toBe('done')
	expect(envelopeStatus.locked_by).toBeNull()
	expect(envelopeStatus.locked_until).toBeNull()

	const eventRow = db.prepare('SELECT actor_id, envelope_id, event_type, event_json FROM actor_events WHERE id = ?').get('evt-1') as {
		actor_id: string
		envelope_id: string
		event_type: string
		event_json: string
	}
	expect(eventRow.actor_id).toBe('intents/invoice-7')
	expect(eventRow.envelope_id).toBe('env-in')
	expect(eventRow.event_type).toBe('processed')
	expect(JSON.parse(eventRow.event_json)).toEqual({ ok: true })

	const outgoingStatus = db.prepare('SELECT status FROM envelopes WHERE id = ?').get('env-out') as { status: string }
	expect(outgoingStatus.status).toBe('queued')

	const actorLockCount = db.prepare('SELECT COUNT(*) AS count FROM actor_locks').get() as { count: number }
	expect(actorLockCount.count).toBe(0)
})