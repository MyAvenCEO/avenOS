import { expect, test } from 'bun:test'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SqlitePersistence } from '@jaensen/persistence-sqlite'

import { createWebApi } from '../src/index'

test('daemon continues after tick failures', async () => {
	let calls = 0
	const api = await createWebApi({
		persistence: new SqlitePersistence(),
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: { async route() { return { type: 'create_intent', title: 'x', initialGoal: 'y', reason: 'z' } } },
		intentBrain: { async decide() { return { summary: 'noop', actions: [] } } },
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})
	await api.stopDaemon()
	const originalTick = api.app.tick
	api.app.tick = async () => {
		calls += 1
		if (calls === 1) throw new Error('tick boom')
		return 'idle'
	}

	try {
		api.startDaemon()
		await new Promise((resolve) => setTimeout(resolve, 150))
		expect(calls).toBeGreaterThan(1)
	} finally {
		api.app.tick = originalTick
		await api.stop()
	}
})

test('POST /api/messages returns envelope and correlation ids, and intent endpoints expose runtime state', async () => {
	const persistence = new SqlitePersistence()
	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: {
			async route() {
				return {
					type: 'create_intent',
					title: 'Repo review',
					initialGoal: 'Please review this repo',
					reason: 'New user input'
				}
			}
		},
		intentBrain: {
			async decide() {
				return {
					summary: 'Please review this repo',
					actions: [{ type: 'reply_user', message: 'Starting review' }]
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

	try {
		const messageResponse = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'please review this repo', attachments: [] })
		})

		expect(messageResponse.status).toBe(202)
		const messageBody = (await messageResponse.json()) as {
			envelopeId: string
			correlationId: string
		}
		expect(typeof messageBody.envelopeId).toBe('string')
		expect(messageBody.correlationId).toBe(messageBody.envelopeId)

		await waitFor(async () => {
			const intentsResponse = await fetch(`${api.url}api/intents`)
			const body = (await intentsResponse.json()) as { intents: Array<{ id: string }> }
			return body.intents[0]?.id ?? null
		})

		const intentsResponse = await fetch(`${api.url}api/intents`)
		const intentsBody = (await intentsResponse.json()) as {
			intents: Array<{ id: string; title: string; summary: string; status: string }>
		}

		expect(intentsBody.intents).toHaveLength(1)
		expect(intentsBody.intents[0]).toMatchObject({
			title: 'Repo review',
			summary: 'Please review this repo',
			status: 'active'
		})

		const intentId = intentsBody.intents[0].id

		const intentResponse = await fetch(`${api.url}api/intents/${intentId}`)
		const intentBody = (await intentResponse.json()) as { id: string; title: string }
		expect(intentBody.id).toBe(intentId)

		const eventsResponse = await fetch(`${api.url}api/intents/${intentId}/events`)
		const eventsBody = (await eventsResponse.json()) as { events: Array<{ type: string }> }
		expect(eventsBody.events.some((event) => event.type === 'intent.created')).toBe(true)
		expect(eventsBody.events.some((event) => event.type === 'intent.message_to_user')).toBe(true)
	} finally {
		await api.stop()
	}
})

test('POST /api/messages forwards intentIdHint to the queued envelope payload', async () => {
	const persistence = new SqlitePersistence()
	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: {
			async route() {
				return {
					type: 'create_intent',
					title: 'Follow-up',
					initialGoal: 'Handle follow-up',
					reason: 'New user input'
				}
			}
		},
		intentBrain: {
			async decide() {
				return { state: undefined, summary: 'noop', actions: [] } as never
			}
		},
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})

	try {
		const response = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'That works', intentIdHint: 'intent-123', attachments: [] })
		})
		expect(response.status).toBe(202)
		const body = (await response.json()) as { envelopeId: string }
		const row = persistence.db.prepare('SELECT payload_json FROM envelopes WHERE id = ?').get(body.envelopeId) as {
			payload_json: string
		}
		expect(JSON.parse(row.payload_json)).toEqual({
			text: 'That works',
			attachments: [],
			attachmentScopeId: expect.any(String),
			intentIdHint: 'intent-123'
		})
	} finally {
		await api.stop()
	}
})

test('POST /api/messages rejects client-supplied attachment paths', async () => {
	const persistence = new SqlitePersistence()
	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: {
			async route() {
				return { type: 'create_intent', title: 'Upload', initialGoal: 'Use upload', reason: 'upload' }
			}
		},
		intentBrain: { async decide() { return { state: undefined, summary: 'noop', actions: [] } as never } },
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})

	try {
		const attachment = {
			id: 'att-1',
			name: 'brief.txt',
			mimeType: 'text/plain',
			path: '.jaensen/uploads/att-1/brief.txt',
			sizeBytes: 5,
			sha256: 'a'.repeat(64),
			base64: 'aGVsbG8='
		}
		const response = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'That works', attachments: [attachment] })
		})
		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Client-provided attachment paths are not allowed.' })
	} finally {
		await api.stop()
	}
})

test('POST /api/attachments stages uploads and POST /api/messages accepts returned attachment ids', async () => {
	const persistence = new SqlitePersistence()
	const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'jaensen-web-api-uploads-'))
	const api = await createWebApi({
		persistence,
		workspaceRoot,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: { async route() { return { type: 'create_intent', title: 'Upload', initialGoal: 'Use upload', reason: 'upload' } } },
		intentBrain: { async decide() { return { state: undefined, summary: 'noop', actions: [] } as never } },
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})

	try {
		const uploadResponse = await fetch(`${api.url}api/attachments`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ attachments: [{ name: '../brief.txt', mimeType: 'text/plain', base64: 'aGVsbG8=' }] })
		})
		expect(uploadResponse.status).toBe(201)
		const sessionId = uploadResponse.headers.get('x-jaensen-session-id')
		expect(sessionId).toEqual(expect.any(String))
		const uploadBody = (await uploadResponse.json()) as { attachments: Array<Record<string, unknown>> }
		expect(uploadBody.attachments).toHaveLength(1)
		expect(uploadBody.attachments[0]).toEqual({
			id: expect.any(String),
			name: 'brief.txt',
			mimeType: 'text/plain',
			sizeBytes: 5,
			sha256: expect.any(String)
		})

		const messageResponse = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-jaensen-session-id': sessionId ?? '' },
			body: JSON.stringify({ text: 'That works', attachments: [{ id: uploadBody.attachments[0]?.id }] })
		})
		expect(messageResponse.status).toBe(202)
		const body = (await messageResponse.json()) as { envelopeId: string }
		const row = persistence.db.prepare('SELECT payload_json FROM envelopes WHERE id = ?').get(body.envelopeId) as { payload_json: string }
		expect(JSON.parse(row.payload_json)).toEqual({
			text: 'That works',
			attachments: [
				{
					id: expect.any(String),
					name: 'brief.txt',
					mimeType: 'text/plain',
					sizeBytes: 5,
					sha256: expect.any(String)
				}
			],
			attachmentScopeId: expect.any(String),
			intentIdHint: undefined
		})

		const payload = JSON.parse(row.payload_json) as {
			attachments: Array<{ id: string }>
			attachmentScopeId: string
		}
		expect(payload.attachments[0]).not.toHaveProperty('path')

		const requestBlobPath = path.join(
			workspaceRoot,
			'.jaensen/uploads/requests',
			payload.attachmentScopeId,
			payload.attachments[0].id,
			'blob'
		)
		await access(requestBlobPath)
		expect(await readFile(requestBlobPath, 'utf8')).toBe('hello')
	} finally {
		await api.stop()
	}
})

test('POST /api/messages rejects invalid x-jaensen-session-id', async () => {
	const persistence = new SqlitePersistence()
	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: { async route() { return { type: 'create_intent', title: 'Upload', initialGoal: 'Use upload', reason: 'upload' } } },
		intentBrain: { async decide() { return { state: undefined, summary: 'noop', actions: [] } as never } },
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})

	try {
		const response = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-jaensen-session-id': '../bad-session'
			},
			body: JSON.stringify({ text: 'That works', attachments: [] })
		})
		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Invalid session id.' })
	} finally {
		await api.stop()
	}
})

test('staged uploads can be consumed only once', async () => {
	const persistence = new SqlitePersistence()
	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: { async route() { return { type: 'create_intent', title: 'Upload', initialGoal: 'Use upload', reason: 'upload' } } },
		intentBrain: { async decide() { return { state: undefined, summary: 'noop', actions: [] } as never } },
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})

	try {
		const uploadResponse = await fetch(`${api.url}api/attachments`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ attachments: [{ name: 'brief.txt', mimeType: 'text/plain', base64: 'aGVsbG8=' }] })
		})
		expect(uploadResponse.status).toBe(201)
		const sessionId = uploadResponse.headers.get('x-jaensen-session-id') ?? ''
		const uploadBody = (await uploadResponse.json()) as { attachments: Array<{ id: string }> }
		const stagedId = uploadBody.attachments[0]?.id

		const firstConsume = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-jaensen-session-id': sessionId },
			body: JSON.stringify({ text: 'first', attachments: [{ id: stagedId }] })
		})
		expect(firstConsume.status).toBe(202)

		const secondConsume = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-jaensen-session-id': sessionId },
			body: JSON.stringify({ text: 'second', attachments: [{ id: stagedId }] })
		})
		expect(secondConsume.status).toBe(400)
		expect(await secondConsume.json()).toEqual({
			error: `Attachment has already been consumed: ${stagedId}`
		})
	} finally {
		await api.stop()
	}
})

test('GET /api/events supports after cursors', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()
	await persistence.upsertActor({
		id: 'intents/demo',
		kind: 'intent',
		state: { intentId: 'demo', title: 'Demo', goal: 'Demo', status: 'active', summary: 'Demo', pendingSkillCalls: {} }
	})
	await persistence.enqueue({
		id: 'env-demo',
		fromActor: 'human',
		toActor: 'intents/demo',
		type: 'intent.start',
		correlationId: 'env-demo',
		payload: { intentId: 'demo' }
	})

	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		dispatcherBrain: { async route() { throw new Error('unused') } },
		intentBrain: { async decide() { throw new Error('unused') } },
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})

	try {
		const allResponse = await fetch(`${api.url}api/events?scope=global`)
		const allBody = (await allResponse.json()) as { events: Array<{ seq: number }> }
		const firstSeq = allBody.events[0]?.seq ?? 0
		const afterResponse = await fetch(`${api.url}api/events?scope=global&after=${firstSeq}`)
		const afterBody = (await afterResponse.json()) as { events: Array<{ seq: number }> }
		expect(afterBody.events.every((event) => event.seq > firstSeq)).toBe(true)
	} finally {
		await api.stop()
	}
})

test('aven-ceo flow can post a message, inspect intents, and keep the SSE stream alive long enough to receive intent events', async () => {
	const persistence = new SqlitePersistence()
	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		pollIntervalMs: 10,
		streamHeartbeatMs: 20,
		idleTimeoutSeconds: 1,
		dispatcherBrain: {
			async route() {
				return {
					type: 'create_intent',
					title: 'CEO follow-up',
					initialGoal: 'Check whether the web api is healthy',
					reason: 'New user input'
				}
			}
		},
		intentBrain: {
			async decide() {
				return {
					summary: 'Check whether the web api is healthy',
					actions: [{ type: 'reply_user', message: 'Everything is underway' }]
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

	try {
		const postResponse = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'is everything working as expected?', attachments: [] })
		})
		expect(postResponse.status).toBe(202)

		const intentId = await waitFor(async () => {
			const intentsResponse = await fetch(`${api.url}api/intents`)
			const body = (await intentsResponse.json()) as { intents: Array<{ id: string }> }
			return body.intents[0]?.id ?? null
		})

		const detailResponse = await fetch(`${api.url}api/intents/${intentId}`)
		expect(detailResponse.status).toBe(200)

		const streamResponse = await fetch(`${api.url}api/events/stream?scope=${encodeURIComponent(`intents/${intentId}`)}`)
		expect(streamResponse.status).toBe(200)
		expect(streamResponse.headers.get('content-type')).toContain('text/event-stream')

		const streamText = await readStreamUntil(streamResponse, [
			'event: intent.created',
			'event: intent.message_to_user',
			': heartbeat '
		])

		expect(streamText).toContain('retry: 10')
		expect(streamText).toContain('event: intent.created')
		expect(streamText).toContain('event: intent.message_to_user')
		expect(streamText).toContain('"payload":')
		expect(streamText).toContain('"createdAt":')
		expect(streamText).toContain(': heartbeat ')
	} finally {
		await api.stop()
	}
})

test('debug actor endpoints expose snapshots and runtime events', async () => {
	const persistence = new SqlitePersistence()
	const api = await createWebApi({
		persistence,
		harness: createHarnessStub(),
		skills: [],
		pollIntervalMs: 10,
		streamHeartbeatMs: 20,
		dispatcherBrain: {
			async route() {
				return {
					type: 'create_intent',
					title: 'Debug me',
					initialGoal: 'Exercise debug visibility',
					reason: 'visibility test'
				}
			}
		},
		intentBrain: {
			async decide() {
				return { summary: 'ok', actions: [{ type: 'reply_user', message: 'done' }] }
			}
		},
		skillSupervisorBrain: { async decide() { return { state: {} } } },
		skillWorkerBrain: { async run() { return { state: {} } } }
	})

	try {
		const initialSnapshot = (await (await fetch(`${api.url}debug/actors`)).json()) as { actors: Array<{ id: string }> }
		expect(initialSnapshot.actors.some((actor) => actor.id === 'dispatcher')).toBe(true)

		const streamResponse = await fetch(`${api.url}debug/actors/events`)
		expect(streamResponse.status).toBe(200)
		expect(streamResponse.headers.get('content-type')).toContain('text/event-stream')

		const postResponse = await fetch(`${api.url}api/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'show debug actor events', attachments: [] })
		})
		expect(postResponse.status).toBe(202)

		const streamText = await readStreamUntil(streamResponse, ['event: MessageSent', 'event: ActorStateChanged'])
		expect(streamText).toContain('event: MessageSent')
		expect(streamText).toContain('event: ActorStateChanged')

		const snapshot = (await (await fetch(`${api.url}debug/actors`)).json()) as {
			actors: Array<{ id: string; type: string }>
		}
		expect(snapshot.actors.some((actor) => actor.id.startsWith('intents/') && actor.type === 'intent')).toBe(true)
	} finally {
		await api.stop()
	}
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

async function waitFor<T>(callback: () => Promise<T | null>, timeoutMs = 2_000): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = await callback()
		if (value !== null) {
			return value
		}
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
	throw new Error('Timed out waiting for condition')
}

async function readStreamUntil(
	response: Response,
	expectedSnippets: string[],
	timeoutMs = 2_000
): Promise<string> {
	if (!response.body) {
		throw new Error('Expected response body to be present')
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	const deadline = Date.now() + timeoutMs
	let output = ''

	try {
		while (Date.now() < deadline) {
			const remainingMs = Math.max(1, deadline - Date.now())
			const result = await Promise.race([
				reader.read(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Timed out waiting for stream data')), remainingMs)
				)
			])

			if (result.done) {
				break
			}

			output += decoder.decode(result.value, { stream: true })
			if (expectedSnippets.every((snippet) => output.includes(snippet))) {
				return output
			}
		}
	} finally {
		reader.releaseLock()
	}

	throw new Error(`Timed out waiting for expected stream snippets. Received: ${output}`)
}