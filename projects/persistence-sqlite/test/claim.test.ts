import { expect, test } from 'bun:test'

import {
	DISPATCHER_ACTOR_ID,
	createIntentActorId,
	createSkillActorId,
	createStableWorkerActorId,
	createWorkerActorId
} from '../src/actor-id'
import { SqlitePersistence } from '../src/sqlite-persistence'

test('claimNext creates missing actors and never claims two envelopes for the same actor at once', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.enqueue({
		id: 'env-1',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('order-123'),
		type: 'message',
		runId: 'corr-1',
		payload: { step: 1 },
		createdAt: '2026-05-12T00:00:00.000Z'
	})
	await persistence.enqueue({
		id: 'env-2',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('order-123'),
		type: 'message',
		runId: 'corr-2',
		payload: { step: 2 },
		createdAt: '2026-05-12T00:00:01.000Z'
	})
	await persistence.enqueue({
		id: 'env-3',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createSkillActorId('extract'),
		type: 'message',
		runId: 'corr-3',
		payload: { step: 3 },
		createdAt: '2026-05-12T00:00:02.000Z'
	})

	const now = new Date('2026-05-12T00:00:10.000Z')
	const firstClaim = await persistence.claimNext({ workerId: 'worker-a', leaseMs: 30_000, now })
	const secondClaim = await persistence.claimNext({ workerId: 'worker-b', leaseMs: 30_000, now })
	const thirdClaim = await persistence.claimNext({ workerId: 'worker-c', leaseMs: 30_000, now })

	expect(firstClaim?.envelope.id).toBe('env-1')
	expect(firstClaim?.actor.id).toBe(createIntentActorId('order-123'))
	expect(firstClaim?.actor.kind).toBe('intent')
	expect(firstClaim?.envelope.status).toBe('processing')
	expect(firstClaim?.envelope.attempts).toBe(1)

	expect(secondClaim?.envelope.id).toBe('env-3')
	expect(secondClaim?.actor.id).toBe(createSkillActorId('extract'))

	expect(thirdClaim).toBeNull()

	const createdActor = await persistence.getActor(createIntentActorId('order-123'))
	expect(createdActor?.state).toEqual({})
	expect(createdActor?.version).toBe(0)
})

test('claimNext seeds missing intent actors from intent.start payload', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.enqueue({
		id: 'env-start',
		fromActor: DISPATCHER_ACTOR_ID,
		toActor: createIntentActorId('intent-123'),
		type: 'intent.start',
		runId: 'corr-start',
		payload: {
			intentId: 'intent-123',
			title: 'Greeting',
			goal: 'Help the user say hello'
		},
		createdAt: '2026-05-12T00:00:00.000Z'
	})

	const claimed = await persistence.claimNext({
		workerId: 'worker-a',
		leaseMs: 30_000,
		now: new Date('2026-05-12T00:00:10.000Z')
	})

	expect(claimed?.actor.id).toBe(createIntentActorId('intent-123'))
	expect(claimed?.actor.kind).toBe('intent')
	expect(claimed?.actor.state).toEqual({
		intentId: 'intent-123',
		title: 'Greeting',
		goal: 'Help the user say hello',
		status: 'active',
		summary: 'Help the user say hello',
		pendingSkillCalls: {}
	})
	const actor = await persistence.getActor(createIntentActorId('intent-123'))
	expect(actor?.state).toEqual({
		intentId: 'intent-123',
		title: 'Greeting',
		goal: 'Help the user say hello',
		status: 'active',
		summary: 'Help the user say hello',
		pendingSkillCalls: {}
	})
})

test('listActorHierarchy returns structural and observed descendants for a branch', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.upsertActor({ id: createSkillActorId('invoice-extractor'), kind: 'skill', state: {} })
	const workerJob01 = createStableWorkerActorId('invoice-extractor', 'job-01')
	await persistence.upsertActor({ id: workerJob01, kind: 'worker', state: {} })

	await persistence.appendEvents([
		{
			type: 'actor.io.shell',
			visibility: 'debug',
			actorId: createStableWorkerActorId('invoice-extractor', 'job-02'),
			payload: { actorId: createStableWorkerActorId('invoice-extractor', 'job-02') },
			createdAt: '2026-05-12T00:00:00.000Z'
		}
	])

	const current = await persistence.listActorHierarchy({ rootActorId: createSkillActorId('invoice-extractor') })
	expect(current.map((row) => row.actorId)).toEqual([workerJob01])
	expect(current[0]).toMatchObject({
		parentActorId: `${createSkillActorId('invoice-extractor')}/workers`,
		depth: 2,
		isCurrent: true
	})

	const observed = await persistence.listActorHierarchy({ rootActorId: createSkillActorId('invoice-extractor'), observed: true })
	expect(observed.map((row) => row.actorId)).toContain(createStableWorkerActorId('invoice-extractor', 'job-02'))
})