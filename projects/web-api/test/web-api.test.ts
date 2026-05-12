import { expect, test } from 'bun:test'

import { SqlitePersistence } from '@jaensen/persistence-sqlite'

import { createWebApi } from '../src/index'

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

test('GET /api/events supports after cursors', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()
	await persistence.upsertActor({
		id: 'intent/demo',
		kind: 'intent',
		state: { intentId: 'demo', title: 'Demo', goal: 'Demo', status: 'active', summary: 'Demo', pendingSkillCalls: {} }
	})
	await persistence.enqueue({
		id: 'env-demo',
		fromActor: 'human',
		toActor: 'intent/demo',
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

		const streamResponse = await fetch(`${api.url}api/events/stream?scope=${encodeURIComponent(`intent/${intentId}`)}`)
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