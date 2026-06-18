import type { Context } from 'hono'
import { auth } from './auth'
import { ensureSession, getSessionMessages, listSessions, persistMessage } from './chat'
import { getUsageStats, recordUsage, type TokenUsage } from './usage'

/**
 * Authenticated proxy for Tinfoil private AI inference. Only a request carrying a valid
 * Better Auth session (cookie or `Authorization: Bearer` token) may run a completion —
 * the TINFOIL_API_KEY never leaves the server. Non-streaming, OpenAI-compatible.
 *
 * Note: this is a server-side HTTPS proxy to Tinfoil's OpenAI-compatible endpoint; it does
 * NOT perform the client-side enclave attestation the native Rust SDK does. The gate here
 * is "only authenticated users can spend inference", not attestation. board 0051.
 */
const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
const TINFOIL_MODEL = process.env.TINFOIL_MODEL ?? 'gemma4-31b'

export async function aiChat(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)

	const key = process.env.TINFOIL_API_KEY
	if (!key) return c.json({ error: 'TINFOIL_API_KEY not configured' }, 503)

	const body = (await c.req.json().catch(() => null)) as {
		messages?: unknown
		model?: string
		stream?: boolean
		sessionId?: string
	} | null
	const messages = body?.messages
	if (!Array.isArray(messages) || messages.length === 0) {
		return c.json({ error: 'messages[] required' }, 400)
	}
	const wantStream = body?.stream === true
	const userId = session.user.id
	const model = body?.model ?? TINFOIL_MODEL

	// Persist the new user turn (the last user message) into the caller's session.
	const lastUserText =
		[...(messages as { role?: string; content?: string }[])]
			.reverse()
			.find((m) => m.role === 'user')?.content ?? ''
	const chatSessionId = await ensureSession(userId, body?.sessionId, lastUserText)
	await persistMessage(chatSessionId, 'user', lastUserText).catch((e) =>
		console.error('[ai] persist user message failed:', e)
	)

	const upstream = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, messages, stream: wantStream })
	}).catch((e) => {
		throw new Error(`tinfoil fetch failed: ${e instanceof Error ? e.message : String(e)}`)
	})

	if (!upstream.ok) {
		const detail = await upstream.text().catch(() => '')
		return c.json({ error: `tinfoil_error_${upstream.status}`, detail: detail.slice(0, 500) }, 502)
	}

	// Streaming: tee Tinfoil's OpenAI-style SSE — forward each chunk to the client AND
	// accumulate the assistant content + capture the (cumulative) `usage` so we can
	// persist the message and record usage once the stream ends. Session id is returned
	// to the client via the X-Session-Id header (exposed by CORS).
	if (wantStream && upstream.body) {
		const reader = upstream.body.getReader()
		const decoder = new TextDecoder()
		let buf = ''
		let lastUsage: TokenUsage | null = null
		let assistant = ''
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				try {
					while (true) {
						const { done, value } = await reader.read()
						if (done) break
						controller.enqueue(value)
						buf += decoder.decode(value, { stream: true })
						const events = buf.split('\n\n')
						buf = events.pop() ?? ''
						for (const ev of events) {
							const line = ev.split('\n').find((l) => l.startsWith('data:'))
							if (!line) continue
							const payload = line.slice(5).trim()
							if (payload === '[DONE]') continue
							try {
								const json = JSON.parse(payload) as {
									usage?: TokenUsage
									choices?: { delta?: { content?: string } }[]
								}
								if (json.usage) lastUsage = json.usage
								const delta = json.choices?.[0]?.delta?.content
								if (delta) assistant += delta
							} catch {
								/* keep-alive / partial frame */
							}
						}
					}
				} finally {
					controller.close()
					if (assistant) {
						await persistMessage(chatSessionId, 'assistant', assistant).catch((e) =>
							console.error('[ai] persist assistant (stream) failed:', e)
						)
					}
					if (lastUsage) {
						await recordUsage(userId, model, lastUsage).catch((e) =>
							console.error('[ai] recordUsage (stream) failed:', e)
						)
					}
				}
			}
		})
		return new Response(stream, {
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				'X-Session-Id': chatSessionId
			}
		})
	}

	const data = (await upstream.json()) as {
		choices?: { message?: { content?: string } }[]
		usage?: TokenUsage
	}
	const content = data.choices?.[0]?.message?.content ?? ''
	if (content) {
		await persistMessage(chatSessionId, 'assistant', content).catch((e) =>
			console.error('[ai] persist assistant failed:', e)
		)
	}
	if (data.usage) {
		await recordUsage(userId, model, data.usage).catch((e) =>
			console.error('[ai] recordUsage failed:', e)
		)
	}
	return c.json({ content, usage: data.usage ?? null, sessionId: chatSessionId })
}

/** Session-gated: the signed-in user's token usage (all-time total + current week). */
export async function aiUsage(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	return c.json(await getUsageStats(session.user.id))
}

/** Session-gated: the caller's own chat sessions (most recent first). */
export async function aiSessions(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	return c.json({ sessions: await listSessions(session.user.id) })
}

/** Session-gated: messages for a session the caller owns (404 otherwise). */
export async function aiSessionMessages(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'session id required' }, 400)
	const messages = await getSessionMessages(session.user.id, id)
	if (!messages) return c.json({ error: 'not_found' }, 404)
	return c.json({ messages })
}
