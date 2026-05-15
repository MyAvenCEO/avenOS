import { expect, test } from 'bun:test'

import {
	DISPATCHER_ACTOR_ID,
	createIntentActorId,
	createSkillActorId,
	createWorkerActorId
} from '../src/actor-id'
import { SqlitePersistence } from '../src/sqlite-persistence'

test('commitActivation updates actor state, appends context, emits events, and enqueues outgoing envelopes atomically', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({
		id: createIntentActorId('invoice-7'),
		kind: 'intent',
		state: { phase: 'queued' }
	})

	await persistence.enqueue({
		id: 'env-in',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('invoice-7'),
		type: 'message',
		runId: 'corr-in',
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
		actorId: createIntentActorId('invoice-7'),
		expectedActorVersion: 0,
		nextActorState: { phase: 'processed' },
		contextAppends: [
			{
				kind: 'fact',
				visibility: 'worklog',
				runId: 'corr-in',
				intentId: 'invoice-7',
				key: 'invoice.status',
				body: { ok: true },
				summary: 'Invoice processed'
			}
		],
		commands: [
			{
				type: 'emit_event',
				event: {
					id: 'evt-1',
					actorId: createIntentActorId('invoice-7'),
					eventType: 'processed',
					event: { ok: true }
				}
			},
			{
				type: 'send_envelope',
				envelope: {
					id: 'env-out',
					fromActor: createIntentActorId('invoice-7'),
					toActor: createSkillActorId('extract'),
					type: 'extract-request',
					runId: 'corr-out',
					causedBy: 'env-in',
					payload: { archiveKey: 'archive-7' }
				}
			}
		],
		now: new Date('2026-05-12T00:01:00.000Z')
	})

	const actor = await persistence.getActor(createIntentActorId('invoice-7'))
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

	const eventRow = db.prepare("SELECT actor_id, envelope_id, type, payload_json FROM events WHERE type = 'actor.event' ORDER BY seq ASC LIMIT 1").get() as {
		actor_id: string
		envelope_id: string
		type: string
		payload_json: string
	}
	expect(eventRow.actor_id).toBe(createIntentActorId('invoice-7'))
	expect(eventRow.envelope_id).toBe('env-in')
	expect(eventRow.type).toBe('actor.event')
	expect(JSON.parse(eventRow.payload_json)).toEqual({
		actorId: createIntentActorId('invoice-7'),
		eventType: 'processed',
		event: { ok: true }
	})

	const outgoingStatus = db.prepare('SELECT status FROM envelopes WHERE id = ?').get('env-out') as { status: string }
	expect(outgoingStatus.status).toBe('queued')

	const actorLockCount = db.prepare('SELECT COUNT(*) AS count FROM actor_locks').get() as { count: number }
	expect(actorLockCount.count).toBe(0)

	const events = await persistence.listEvents({ actorId: createIntentActorId('invoice-7') })
	expect(events.some((event) => event.type === 'actor.io.inbound')).toBe(true)
	expect(events.some((event) => event.type === 'actor.io.outbound')).toBe(true)
	expect(events.some((event) => event.type === 'context.appended')).toBe(true)

	const contextItems = await persistence.listContextItems({
		selector: { runId: 'corr-in' }
	})
	expect(contextItems).toHaveLength(1)
	expect(contextItems[0]).toMatchObject({
		kind: 'fact',
		key: 'invoice.status',
		summary: 'Invoice processed',
		runId: 'corr-in'
	})
})

test('commitActivation clears stale last_error on success', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({
		id: createIntentActorId('commit-clear-error'),
		kind: 'intent',
		state: { phase: 'queued' }
	})

	await persistence.enqueue({
		id: 'env-clear-error',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('commit-clear-error'),
		type: 'message',
		runId: 'corr-clear-error',
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
		actorId: createIntentActorId('commit-clear-error'),
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

test('listContextItems filters by normalized run/intent/call/actor metadata and snapshotSeq', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({
		id: createIntentActorId('intent-ctx'),
		kind: 'intent',
		state: { status: 'active' }
	})
	await persistence.enqueue({
		id: 'env-ctx',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('intent-ctx'),
		type: 'intent.start',
		runId: 'corr-ctx',
		payload: { intentId: 'intent-ctx', callId: 'call-a' }
	})
	await persistence.claimNext({ workerId: 'worker-ctx', leaseMs: 60_000, now: new Date('2026-05-12T00:00:00.000Z') })
	await persistence.commitActivation({
		workerId: 'worker-ctx',
		envelopeId: 'env-ctx',
		actorId: createIntentActorId('intent-ctx'),
		expectedActorVersion: 0,
		nextActorState: { status: 'active', intentId: 'intent-ctx' },
		contextAppends: [
			{
				kind: 'fact',
				visibility: 'worklog',
				runId: 'corr-ctx',
				intentId: 'intent-ctx',
				actorId: createIntentActorId('intent-ctx'),
				callId: 'call-a',
				key: 'run.fact',
			},
			{
				kind: 'decision',
				visibility: 'worklog',
				runId: 'corr-ctx',
				intentId: 'intent-ctx',
				actorId: createIntentActorId('intent-ctx'),
				callId: 'call-a',
				key: 'intent.decision',
			},
			{
				kind: 'handoff',
				visibility: 'worklog',
				runId: 'corr-ctx',
				intentId: 'intent-ctx',
				actorId: createIntentActorId('intent-ctx'),
				callId: 'call-a',
				key: 'call.handoff',
			},
			{
				kind: 'observation',
				visibility: 'worklog',
				runId: 'corr-ctx',
				intentId: 'intent-ctx',
				actorId: createIntentActorId('intent-ctx'),
				callId: 'call-a',
				key: 'actor.observation',
			}
		],
		commands: [],
		now: new Date('2026-05-12T00:00:01.000Z')
	})

	const all = await persistence.listContextItems({ selector: {} })
	const snapshotSeq = all[1]?.seq
	expect((await persistence.listContextItems({ selector: { runId: 'corr-ctx' } })).map((item) => item.key)).toEqual([
		'run.fact',
		'intent.decision',
		'call.handoff',
		'actor.observation'
	])
	expect((await persistence.listContextItems({ selector: { intentId: 'intent-ctx' } })).map((item) => item.key)).toEqual([
		'run.fact',
		'intent.decision',
		'call.handoff',
		'actor.observation'
	])
	expect((await persistence.listContextItems({ selector: { callId: 'call-a' } })).map((item) => item.key)).toEqual([
		'run.fact',
		'intent.decision',
		'call.handoff',
		'actor.observation'
	])
	expect((await persistence.listContextItems({ selector: { actorId: createIntentActorId('intent-ctx') } })).map((item) => item.key)).toEqual([
		'run.fact',
		'intent.decision',
		'call.handoff',
		'actor.observation'
	])
	expect((await persistence.listContextItems({ selector: {}, snapshotSeq })).length).toBe(2)
})

	test('appendContext defaults visibility to worklog and stores nulls for undefined optionals', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

		const seq = await persistence.appendContext({
			kind: 'fact',
			body: { ok: true }
		})
		const [item] = await persistence.listContextItems({ selector: { afterSeq: seq - 1 } })
		expect(item).toMatchObject({
			seq,
			kind: 'fact',
			visibility: 'worklog',
			runId: null,
			intentId: null,
			actorId: null,
			envelopeId: null,
			callId: null,
			key: null,
			summary: null,
			artifactUri: null,
			body: { ok: true }
		})
})

test('appendEvents persists actor prompt/task/shell IO traces', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()
	const workerActorId = createWorkerActorId('memory', 'topic-jaensen-architecture')

	await persistence.appendEvents([
		{
			type: 'actor.io.prompt',
			visibility: 'debug',
			actorId: workerActorId,
			payload: { actorId: workerActorId, trace: { kind: 'prompt', label: 'worker', inputSummary: 'hi', at: '2026-05-12T00:00:00.000Z' } },
			createdAt: '2026-05-12T00:00:00.000Z'
		},
		{
			type: 'actor.io.shell',
			visibility: 'debug',
			actorId: workerActorId,
			payload: { actorId: workerActorId, trace: { kind: 'shell', label: 'worker', command: 'ls', exitCode: 0, at: '2026-05-12T00:00:01.000Z' } },
			createdAt: '2026-05-12T00:00:01.000Z'
		}
	])

	const events = await persistence.listEvents({ actorId: workerActorId })
	expect(events.map((event) => event.type)).toEqual(['actor.io.prompt', 'actor.io.shell'])
})

test('listActorBranchLogs filters branch logs and supports chat/deep-dive projections', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.appendEvents([
		{
			type: 'intent.skill_call_started',
			visibility: 'worklog',
			actorId: createSkillActorId('invoice-extractor'),
			payload: {},
			createdAt: '2026-05-12T00:00:00.000Z'
		},
		{
			type: 'actor.event',
			visibility: 'debug',
			actorId: createWorkerActorId('invoice-extractor', 'job-01'),
			payload: {},
			createdAt: '2026-05-12T00:00:01.000Z'
		},
		{
			type: 'intent.skill_call_started',
			visibility: 'worklog',
			actorId: createSkillActorId('other-skill'),
			payload: {},
			createdAt: '2026-05-12T00:00:02.000Z'
		}
	])

	const deepDive = await persistence.listActorBranchLogs({ rootActorId: createSkillActorId('invoice-extractor'), view: 'deep-dive' })
	expect(deepDive.map((row) => row.type)).toEqual(['intent.skill_call_started', 'actor.event'])

	const chat = await persistence.listActorBranchLogs({ rootActorId: createSkillActorId('invoice-extractor'), view: 'chat' })
	expect(chat.map((row) => row.type)).toEqual(['intent.skill_call_started'])
	})

test('listCommunicationTree and summarizeCommunicationTree expose causation tree with aggregated logs', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.enqueue({
		id: 'env-root',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('intent-123'),
		type: 'intent.start',
		runId: 'corr-tree',
		payload: { intentId: 'intent-123', title: 'Hello', goal: 'Do work' },
		createdAt: '2026-05-12T00:00:00.000Z'
	})
	await persistence.enqueue({
		id: 'env-child',
		fromActor: createIntentActorId('intent-123'),
		toActor: createSkillActorId('invoice-extractor'),
		type: 'skill.request',
		runId: 'corr-tree',
		causedBy: 'env-root',
		payload: { request: 'Extract', callId: 'call-1', intentId: 'intent-123' },
		createdAt: '2026-05-12T00:00:01.000Z'
	})

	await persistence.appendEvents([
		{
			type: 'actor.io.shell',
			visibility: 'debug',
			actorId: createSkillActorId('invoice-extractor'),
			envelopeId: 'env-child',
			payload: { command: 'ls', fromActor: createSkillActorId('invoice-extractor'), toActor: createSkillActorId('invoice-extractor') },
			createdAt: '2026-05-12T00:00:01.500Z'
		}
	])

	const tree = await persistence.listCommunicationTree({ runId: 'corr-tree', view: 'deep-dive' })
	expect(tree.map((row) => row.nodeId)).toEqual(expect.arrayContaining(['env:env-root', 'env:env-child']))
	expect(tree.find((row) => row.nodeId === 'env:env-child')?.parentNodeId).toBe('env:env-root')
	expect(tree.find((row) => row.nodeKind === 'log' && row.envelopeId === 'env-child')?.parentNodeId).toBe('env:env-child')

	const summary = await persistence.summarizeCommunicationTree({ runId: 'corr-tree', view: 'deep-dive' })
	expect(summary).toMatchObject({
		rootCount: 1,
		envelopeCount: 2,
		logCount: 3,
		actorCount: 2,
		actorIoCount: 1
	})
})