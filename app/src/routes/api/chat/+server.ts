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
 * All ids here are TEE routes, which is the entire reason for going through
 * RedPill rather than straight to a model host.
 *
 * Qwen replaced Gemma after a head-to-head with the dashboard's own payload:
 * same time to first token (1.3s) and tool round (1.5s) — it is a 3B-active
 * MoE — but with a chat template that has a real tool lane, where Gemma
 * intermittently wrote calls as Python into the name field and, on bad runs,
 * corrupted its own stream outright. Thinking is disabled below; left on, the
 * same request took 8.4s to the first token.
 */
const MODEL = 'qwen/qwen3.6-35b-a3b'

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
			// No deliberation before a voice reply — with thinking on, time to
			// first token measured 8.4s against 1.3s without.
			chat_template_kwargs: { enable_thinking: false },
			// Kept from the Gemma era as cheap insurance against one-token loops;
			// the client's stream guards are the backstop.
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
