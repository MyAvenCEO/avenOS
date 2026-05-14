import { expect, test } from 'bun:test'

import { SqlitePersistence } from '../src/sqlite-persistence'

test('commitActivation updates actor state, appends context, emits events, and enqueues outgoing envelopes atomically', async () => {
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
		nextActorState: { phase: 'processed' },
		contextAppends: [
			{
				scope: { type: 'run', correlationId: 'corr-in' },
				kind: 'fact',
				key: 'invoice.status',
				tags: ['invoice'],
				body: { ok: true },
				summary: 'Invoice processed',
				sourceContextItemIds: []
			}
		],
		commands: [
			{
				type: 'emit_event',
				event: {
					id: 'evt-1',
					actorId: 'intents/invoice-7',
					eventType: 'processed',
					event: { ok: true }
				}
			},
			{
				type: 'send_envelope',
				envelope: {
					id: 'env-out',
					fromActor: 'intents/invoice-7',
					toActor: 'skills/extract',
					type: 'extract-request',
					correlationId: 'corr-out',
					causationId: 'env-in',
					payload: { archiveKey: 'archive-7' }
				}
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
	expect(streamEvents.some((event) => event.type === 'context.appended')).toBe(true)

	const contextItems = await persistence.listContextItems({
		selector: { scopes: [{ type: 'run', correlationId: 'corr-in' }] }
	})
	expect(contextItems).toHaveLength(1)
	expect(contextItems[0]).toMatchObject({
		kind: 'fact',
		key: 'invoice.status',
		summary: 'Invoice processed',
		correlationId: 'corr-in'
	})
})

test('commitActivation clears stale last_error on success', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({
		id: 'intents/commit-clear-error',
		kind: 'intent',
		state: { phase: 'queued' }
	})

	await persistence.enqueue({
		id: 'env-clear-error',
		fromActor: 'dispatcher',
		toActor: 'intents/commit-clear-error',
		type: 'message',
		correlationId: 'corr-clear-error',
		payload: { ok: true }
	})

	await persistence.claimNext({
		workerId: 'worker-clear-error',
		leaseMs: 60_000,
		now: new Date('2026-05-12T00:00:00.000Z')
	})

	persistence.db.prepare('UPDATE envelopes SET last_error = ? WHERE id = ?').run('previous failure', 'env-clear-error')

	await persistence.commitActivation({
		workerId: 'worker-clear-error',
		envelopeId: 'env-clear-error',
		actorId: 'intents/commit-clear-error',
		expectedActorVersion: 0,
		nextActorState: { phase: 'done' },
		contextAppends: [],
		commands: [],
		now: new Date('2026-05-12T00:00:01.000Z')
	})

	const envelope = persistence.db.prepare('SELECT status, last_error FROM envelopes WHERE id = ?').get('env-clear-error') as {
		status: string
		last_error: string | null
	}

	expect(envelope.status).toBe('done')
	expect(envelope.last_error).toBeNull()
})

test('listContextItems supports query by run, intent, call/rootCallId, actor, and snapshotSeq', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({
		id: 'intents/intent-ctx',
		kind: 'intent',
		state: { status: 'active' }
	})
	await persistence.enqueue({
		id: 'env-ctx',
		fromActor: 'dispatcher',
		toActor: 'intents/intent-ctx',
		type: 'intent.start',
		correlationId: 'corr-ctx',
		payload: { intentId: 'intent-ctx', callId: 'call-a', rootCallId: 'root-a' }
	})
	await persistence.claimNext({ workerId: 'worker-ctx', leaseMs: 60_000, now: new Date('2026-05-12T00:00:00.000Z') })
	await persistence.commitActivation({
		workerId: 'worker-ctx',
		envelopeId: 'env-ctx',
		actorId: 'intents/intent-ctx',
		expectedActorVersion: 0,
		nextActorState: { status: 'active', intentId: 'intent-ctx' },
		contextAppends: [
			{
				scope: { type: 'run', correlationId: 'corr-ctx' },
				kind: 'fact',
				key: 'run.fact',
				tags: ['run'],
				sourceContextItemIds: []
			},
			{
				scope: { type: 'intent', intentId: 'intent-ctx' },
				kind: 'decision',
				key: 'intent.decision',
				tags: ['intent'],
				sourceContextItemIds: []
			},
			{
				scope: { type: 'call', callId: 'call-a', rootCallId: 'root-a' },
				kind: 'handoff',
				key: 'call.handoff',
				tags: ['call'],
				sourceContextItemIds: []
			},
			{
				scope: { type: 'actor', actorId: 'intents/intent-ctx' },
				kind: 'observation',
				key: 'actor.observation',
				tags: ['actor'],
				sourceContextItemIds: []
			}
		],
		commands: [],
		now: new Date('2026-05-12T00:00:01.000Z')
	})

	const all = await persistence.listContextItems({ selector: {} })
	const snapshotSeq = all[1]?.seq
	expect((await persistence.listContextItems({ selector: { scopes: [{ type: 'run', correlationId: 'corr-ctx' }] } })).map((item) => item.key)).toEqual(['run.fact'])
	expect((await persistence.listContextItems({ selector: { scopes: [{ type: 'intent', intentId: 'intent-ctx' }] } })).map((item) => item.key)).toEqual(['intent.decision'])
	expect((await persistence.listContextItems({ selector: { scopes: [{ type: 'call', callId: 'call-a', rootCallId: 'root-a' }] } })).map((item) => item.key)).toEqual(['call.handoff'])
	expect((await persistence.listContextItems({ selector: { scopes: [{ type: 'actor', actorId: 'intents/intent-ctx' }] } })).map((item) => item.key)).toEqual(['actor.observation'])
	expect((await persistence.listContextItems({ selector: {}, snapshotSeq })).length).toBe(2)
})

test('listContextItems excludes redacted target rows by default and can include them explicitly', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({ id: 'intents/redact', kind: 'intent', state: {} })
	await persistence.enqueue({
		id: 'env-redact',
		fromActor: 'dispatcher',
		toActor: 'intents/redact',
		type: 'message',
		correlationId: 'corr-redact',
		payload: {}
	})
	await persistence.claimNext({ workerId: 'worker-redact', leaseMs: 60_000, now: new Date('2026-05-12T00:00:00.000Z') })
	await persistence.commitActivation({
		workerId: 'worker-redact',
		envelopeId: 'env-redact',
		actorId: 'intents/redact',
		expectedActorVersion: 0,
		nextActorState: {},
		contextAppends: [
			{ scope: { type: 'intent', intentId: 'redact' }, kind: 'fact', key: 'secret', tags: [], summary: 'secret', sourceContextItemIds: [] }
		],
		commands: [],
		now: new Date('2026-05-12T00:00:01.000Z')
	})
	const target = (await persistence.listContextItems({ selector: { includeRedacted: true } }))[0]

	await persistence.enqueue({
		id: 'env-redact-2',
		fromActor: 'dispatcher',
		toActor: 'intents/redact',
		type: 'message',
		correlationId: 'corr-redact',
		payload: {}
	})
	await persistence.claimNext({ workerId: 'worker-redact', leaseMs: 60_000, now: new Date('2026-05-12T00:00:02.000Z') })
	await persistence.commitActivation({
		workerId: 'worker-redact',
		envelopeId: 'env-redact-2',
		actorId: 'intents/redact',
		expectedActorVersion: 1,
		nextActorState: {},
		contextAppends: [
			{ scope: { type: 'intent', intentId: 'redact' }, kind: 'error', key: 'redaction', tags: ['redaction'], redactsItemId: target.id, sourceContextItemIds: [target.id] }
		],
		commands: [],
		now: new Date('2026-05-12T00:00:03.000Z')
	})

	const defaultItems = await persistence.listContextItems({ selector: {} })
	expect(defaultItems.some((item) => item.id === target.id)).toBe(false)
	const withRedacted = await persistence.listContextItems({ selector: { includeRedacted: true } })
	expect(withRedacted.some((item) => item.id === target.id)).toBe(true)
	expect(withRedacted.some((item) => item.redactsItemId === target.id)).toBe(true)
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