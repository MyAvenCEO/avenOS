import { error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import type { RequestHandler } from './$types'

/**
 * Chat proxy to RedPill (Phala confidential inference).
 *
 * The browser must never hold `REDPILL_API_KEY`, so it talks to this endpoint
 * and this endpoint talks to RedPill. The whole response body is piped straight
 * back untouched — RedPill is OpenAI-compatible, so the client parses ordinary
 * `data: {...}` SSE frames and we stay out of the way.
 *
 * DEV ONLY, deliberately. The app builds with `adapter-static` + `ssr = false`,
 * so there is no server in the shipped Tauri bundle and this route simply does
 * not exist there. Production key handling (a Tauri command signing in Rust, or
 * the relay) is its own piece of work.
 */

// The layout sets `prerender = true`, which cascades to endpoints. A POST route
// cannot be prerendered, so opt this one back out explicitly.
export const prerender = false

const REDPILL_CHAT_URL = 'https://api.redpill.ai/v1/chat/completions'

/**
 * The *confidential* Gemma, not the plain `google/gemma-4-31b-it` route —
 * `phala/…` ids are the ones served inside a TEE, which is the entire reason
 * for going through RedPill rather than straight to a model host.
 */
const MODEL = 'phala/gemma-4-31b-it'

export const POST: RequestHandler = async ({ request, fetch }) => {
	const apiKey = env.PHALA_API_KEY
	if (!apiKey) {
		error(500, 'PHALA_API_KEY is unset — add it to the worktree .env and restart vite')
	}

	const { messages, tools } = await request.json()
	if (!Array.isArray(messages)) error(400, 'body must be { messages: [{ role, content }] }')

	const upstream = await fetch(REDPILL_CHAT_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			stream: true,
			// This deployment intermittently collapses into repeating one token —
			// observed as `}` streamed until the output budget ran out. A modest
			// penalty makes each repetition of the same token less likely than the
			// last, which breaks exactly that loop while leaving prose essentially
			// untouched; the client's stream guard is the backstop, this is the
			// prevention.
			frequency_penalty: 0.3,
			// Tools are shaped here rather than in the client so the wire format
			// stays a detail of the proxy. Omitted entirely when there are none —
			// an empty array reads as "you have no tools", which is true but makes
			// some models apologize about it.
			...(Array.isArray(tools) &&
				tools.length > 0 && {
					tools: tools.map((tool) => ({ type: 'function', function: tool }))
				})
		})
	})

	if (!upstream.ok || !upstream.body) {
		// Surface RedPill's own message — a bad key or an unknown model id both
		// come back here, and guessing which is a waste of everyone's time.
		error(upstream.status, `redpill: ${await upstream.text()}`)
	}

	return new Response(upstream.body, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	})
}
