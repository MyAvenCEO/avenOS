import { expect, test } from 'bun:test'
import { SqlitePersistence } from '@jaensen/persistence-sqlite'

import { createAppNode } from '../src/index'

test('createAppNode ensures startup actors and bootstraps skill supervisors', async () => {
	const persistence = new SqlitePersistence()
	const app = await createAppNode({
		persistence,
		harness: createHarnessStub(),
		skills: [
			{
				id: 'memory',
				path: 'memory/SKILL.md',
				description: 'Memory skill',
				frontmatter: { id: 'memory', description: 'Memory skill' },
				body: '# Memory',
				bodyHash: 'hash-memory',
				loadedAt: '2026-05-12T00:00:00.000Z'
			}
		],
		now: new Date('2026-05-12T00:00:00.000Z')
	})

	expect((await persistence.getActor('dispatcher'))?.kind).toBe('dispatcher')
	expect((await persistence.getActor('dispatcher'))?.state).toEqual({ activeIntents: {} })
	expect((await persistence.getActor('human'))?.kind).toBe('human-outbox')
	expect((await persistence.getActor('human'))?.state).toEqual({ messages: [] })
	expect((await persistence.getActor('skill/memory'))?.kind).toBe('skill-supervisor')
	expect(app.skillRegistry.list().map((skill) => skill.id)).toEqual(['memory'])
})

test('app can enqueue user input and expose human outbox after runtime settles', async () => {
	const persistence = new SqlitePersistence()
	const app = await createAppNode({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: {
			async route() {
				return {
					type: 'create_intent',
					title: 'Greeting',
					initialGoal: 'Say hello',
					reason: 'New request'
				}
			}
		},
		intentBrain: {
			async decide({ state }) {
				return {
					state,
					actions: [{ type: 'reply_user', message: 'Hello from runtime' }]
				}
			}
		},
		skillSupervisorBrain: {
			async decide() {
				return { state: {} }
			}
		},
		skillWorkerBrain: {
			async run() {
				return { state: {} }
			}
		}
	})

	const queued = await app.enqueueUserInput({ text: 'Hi' })
	expect(queued).toEqual({
		envelopeId: expect.any(String),
		correlationId: expect.any(String)
	})
	expect(queued.envelopeId).toBe(queued.correlationId)
	await app.runUntilIdle(20)

	expect(await app.readHumanOutbox()).toEqual([
		{
			type: 'human.message',
			intentId: expect.any(String),
			message: 'Hello from runtime',
			envelopeId: expect.any(String),
			createdAt: expect.any(String)
		}
	])
})

function createHarnessStub() {
	return {
		async session() {
			return {
				async prompt() {
					throw new Error('unexpected prompt')
				},
				async task() {
					throw new Error('unexpected task')
				}
			}
		}
	}
}