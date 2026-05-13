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

	const streamEvents = await persistence.listStreamEvents({ scope: 'actor/intents/invoice-7' })
	expect(streamEvents.some((event) => event.type === 'actor.io.inbound')).toBe(true)
	expect(streamEvents.some((event) => event.type === 'actor.io.outbound')).toBe(true)
})

test('appendStreamEvents persists actor prompt/task/shell IO traces', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.appendStreamEvents([
		{
			id: 'trace-1',
			scope: 'actor/skills/memory/topic-jaensen-architecture',
			actorId: 'skills/memory/topic-jaensen-architecture',
			type: 'actor.io.prompt',
			payload: { actorId: 'skills/memory/topic-jaensen-architecture', trace: { kind: 'prompt', label: 'worker', inputSummary: 'hi', at: '2026-05-12T00:00:00.000Z' } },
			createdAt: '2026-05-12T00:00:00.000Z'
		},
		{
			id: 'trace-2',
			scope: 'actor/skills/memory/topic-jaensen-architecture',
			actorId: 'skills/memory/topic-jaensen-architecture',
			type: 'actor.io.shell',
			payload: { actorId: 'skills/memory/topic-jaensen-architecture', trace: { kind: 'shell', label: 'worker', command: 'ls', exitCode: 0, at: '2026-05-12T00:00:01.000Z' } },
			createdAt: '2026-05-12T00:00:01.000Z'
		}
	])

	const events = await persistence.listStreamEvents({ scope: 'actor/skills/memory/topic-jaensen-architecture' })
	expect(events.map((event) => event.type)).toEqual(['actor.io.prompt', 'actor.io.shell'])
})

test('listActorBranchLogs filters branch logs and supports chat/deep-dive projections', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.appendStreamEvents([
		{
			id: 'log-1',
			scope: 'actor/skills/invoice-extractor',
			actorId: 'skills/invoice-extractor',
			type: 'intent.skill_call_started',
			payload: {},
			createdAt: '2026-05-12T00:00:00.000Z'
		},
		{
			id: 'log-2',
			scope: 'actor/skills/invoice-extractor/job-01',
			actorId: 'skills/invoice-extractor/job-01',
			type: 'actor.event',
			payload: {},
			createdAt: '2026-05-12T00:00:01.000Z'
		},
		{
			id: 'log-3',
			scope: 'actor/skills/other-skill',
			actorId: 'skills/other-skill',
			type: 'intent.skill_call_started',
			payload: {},
			createdAt: '2026-05-12T00:00:02.000Z'
		}
	])

	const deepDive = await persistence.listActorBranchLogs({ rootActorId: 'skills/invoice-extractor', view: 'deep-dive' })
	expect(deepDive.map((row) => row.id)).toEqual(['log-1', 'log-2'])

	const chat = await persistence.listActorBranchLogs({ rootActorId: 'skills/invoice-extractor', view: 'chat' })
	expect(chat.map((row) => row.id)).toEqual(['log-1'])
	})

test('listCommunicationTree and summarizeCommunicationTree expose causation tree with aggregated logs', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.enqueue({
		id: 'env-root',
		fromActor: 'dispatcher',
		toActor: 'intents/intent-123',
		type: 'intent.start',
		correlationId: 'corr-tree',
		payload: { intentId: 'intent-123', title: 'Hello', goal: 'Do work' },
		createdAt: '2026-05-12T00:00:00.000Z'
	})
	await persistence.enqueue({
		id: 'env-child',
		fromActor: 'intents/intent-123',
		toActor: 'skills/invoice-extractor',
		type: 'skill.request',
		correlationId: 'corr-tree',
		causationId: 'env-root',
		payload: { request: 'Extract', callId: 'call-1', intentId: 'intent-123' },
		createdAt: '2026-05-12T00:00:01.000Z'
	})

	await persistence.appendStreamEvents([
		{
			id: 'tree-log-1',
			scope: 'actor/skills/invoice-extractor',
			actorId: 'skills/invoice-extractor',
			envelopeId: 'env-child',
			type: 'actor.io.shell',
			payload: { command: 'ls', fromActor: 'skills/invoice-extractor', toActor: 'skills/invoice-extractor' },
			createdAt: '2026-05-12T00:00:01.500Z'
		}
	])

	const tree = await persistence.listCommunicationTree({ correlationId: 'corr-tree', view: 'deep-dive' })
	expect(tree.map((row) => row.nodeId)).toEqual(expect.arrayContaining(['env:env-root', 'env:env-child', 'log:tree-log-1']))
	expect(tree.find((row) => row.nodeId === 'env:env-child')?.parentNodeId).toBe('env:env-root')
	expect(tree.find((row) => row.nodeId === 'log:tree-log-1')?.parentNodeId).toBe('env:env-child')

	const summary = await persistence.summarizeCommunicationTree({ correlationId: 'corr-tree', view: 'deep-dive' })
	expect(summary).toMatchObject({
		rootCount: 1,
		envelopeCount: 2,
		logCount: 9,
		actorCount: 2,
		actorIoCount: 1
	})
})