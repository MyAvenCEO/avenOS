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
				directActors: [],
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
	expect((await persistence.getActor('skills/memory'))?.kind).toBe('skill-supervisor')
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
			async decide() {
				return {
					summary: 'Say hello',
					actions: [{ type: 'reply_user', message: 'Hello from runtime' }]
				}
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

test('app forwards intentIdHint when enqueueing user input', async () => {
	const persistence = new SqlitePersistence()
	const app = await createAppNode({
		persistence,
		harness: createHarnessStub(),
		skills: []
	})

	const queued = await app.enqueueUserInput({ text: 'Answer', intentIdHint: 'intent-123' })
	const envelope = (persistence as unknown as { db: { query: (sql: string) => { get: (...args: unknown[]) => unknown } } }).db
		.query('SELECT payload_json FROM envelopes WHERE id = ?')
		.get(queued.envelopeId) as { payload_json: string }

	expect(JSON.parse(envelope.payload_json)).toEqual({
		text: 'Answer',
		attachments: undefined,
		attachmentScopeId: undefined,
		intentIdHint: 'intent-123'
	})
})

test('app persists harness prompt/task/shell traces to sqlite stream events', async () => {
	const persistence = new SqlitePersistence()
	const app = await createAppNode({
		persistence,
		harness: createHarnessStub(),
		skills: []
	})

	app.runtime.debug.recordTrace('dispatcher', {
		kind: 'prompt',
		label: 'tester',
		inputSummary: 'hello',
		outputSummary: '{"ok":true}',
		at: '2026-05-12T00:00:00.000Z'
	})
	app.runtime.debug.recordTrace('dispatcher', {
		kind: 'task',
		label: 'tester',
		inputSummary: 'do work',
		outputSummary: '{"ok":true}',
		cwd: '/tmp',
		at: '2026-05-12T00:00:01.000Z'
	})
	app.runtime.debug.recordTrace('dispatcher', {
		kind: 'shell',
		label: 'tester',
		command: 'pwd',
		cwd: '/tmp',
		stdout: 'ok',
		stderr: '',
		exitCode: 0,
		at: '2026-05-12T00:00:02.000Z'
	})

	await new Promise((resolve) => setTimeout(resolve, 0))

	const events = (persistence as unknown as { db: { query: (sql: string) => { all: (...args: unknown[]) => unknown } } }).db
		.query("SELECT type FROM stream_events WHERE type LIKE 'actor.io.%' ORDER BY created_at ASC")
		.all() as Array<{ type: string }>

	expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['actor.io.prompt', 'actor.io.task', 'actor.io.shell']))
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
				},
				async shell() {
					throw new Error('unexpected shell')
				}
			}
		}
	}
}