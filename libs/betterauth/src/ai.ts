import type { Context } from 'hono'
import { auth } from './auth'

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
	} | null
	const messages = body?.messages
	if (!Array.isArray(messages) || messages.length === 0) {
		return c.json({ error: 'messages[] required' }, 400)
	}
	const wantStream = body?.stream === true

	const upstream = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: body?.model ?? TINFOIL_MODEL, messages, stream: wantStream })
	}).catch((e) => {
		throw new Error(`tinfoil fetch failed: ${e instanceof Error ? e.message : String(e)}`)
	})

	if (!upstream.ok) {
		const detail = await upstream.text().catch(() => '')
		return c.json({ error: `tinfoil_error_${upstream.status}`, detail: detail.slice(0, 500) }, 502)
	}

	// Streaming: pipe Tinfoil's OpenAI-style SSE straight through to the client.
	if (wantStream && upstream.body) {
		return new Response(upstream.body, {
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform'
			}
		})
	}

	const data = (await upstream.json()) as {
		choices?: { message?: { content?: string } }[]
		usage?: unknown
	}
	return c.json({ content: data.choices?.[0]?.message?.content ?? '', usage: data.usage ?? null })
}
