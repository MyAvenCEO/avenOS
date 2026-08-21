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
 * Chosen by benchmark against the dashboard's own payload. Gemma corrupted
 * its stream and wrote calls as Python; the 3B-active qwen3.6-35b-a3b matched
 * Gemma's speed but not its judgement. qwen3.5-122b-a10b held this slot on
 * those numbers (ttft 1.1-1.3s, tool call complete in 1.3s) until Phala
 * retired it on 2026-08-27; deepseek-v4-flash is their named successor and
 * inherits the slot. Thinking stays disabled below — with it on, these routes
 * spend many seconds deliberating before the first token.
 */
const MODEL = 'deepseek/deepseek-v4-flash-0731'

/**
 * Second lane: the slower, stronger model, for work an actor's manifest pins
 * to it — careful reasoning where latency is acceptable, unlike the voice
 * lane. Allowlisted so the client cannot request arbitrary ids.
 */
const MODELS = new Set([MODEL, 'moonshotai/kimi-k3'])

export const POST: RequestHandler = async ({ request, fetch }) => {
	const apiKey = env.PHALA_API_KEY
	if (!apiKey) {
		error(500, 'PHALA_API_KEY is unset — add it to the worktree .env and restart vite')
	}

	const { messages, tools, model, temperature, json, max_tokens } = await request.json()
	if (!Array.isArray(messages)) error(400, 'body must be { messages: [{ role, content }] }')
	const chosen = typeof model === 'string' && MODELS.has(model) ? model : MODEL
	// Per-actor sampling: manifests may declare a temperature; clamp it here so
	// the client can never request something the upstream would reject.
	const heat = typeof temperature === 'number' ? Math.max(0, Math.min(2, temperature)) : null

	const upstream = await fetch(REDPILL_CHAT_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model: chosen,
			messages,
			stream: true,
			// The VOICE lane's insurance stays on the voice lane ONLY. Both of
			// these poisoned the kimi design lane: frequency_penalty punishes the
			// very tokens a long constrained-JSON answer must repeat (quotes,
			// braces) until the model flees into endless NOVEL word salad — the
			// live-observed snake_case gibberish; and enable_thinking:false is a
			// Qwen template kwarg that strips a reasoning model of exactly the
			// deliberation careful design work is paying for.
			...(chosen === MODEL && {
				// No deliberation before a voice reply — with thinking on, time to
				// first token measured 8.4s against 1.3s without.
				chat_template_kwargs: { enable_thinking: false },
				// Kept from the Gemma era as cheap insurance against one-token
				// loops; the client's stream guards are the backstop.
				frequency_penalty: 0.3
			}),
			// Explicit and generous: reasoning models spend their deliberation
			// from the SAME completion budget, and the server's default cap
			// truncated long structured answers mid-JSON. The design lane gets
			// double — kimi WITH thinking burned 16k mid-draft in the live test.
			// Clients may ask for LESS (rate limits count REQUESTED tokens);
			// the lane ceiling clamps whatever they ask for.
			max_tokens:
				typeof max_tokens === 'number'
					? Math.max(256, Math.min(chosen === MODEL ? 16384 : 32768, max_tokens))
					: chosen === MODEL
						? 16384
						: 32768,
			// Machine lanes (llm actors) ask for enforced JSON: the
			// server constrains generation grammatically, which ends the whole
			// class of prose-apologies-spliced-into-manifests failures.
			...(json === true && { response_format: { type: 'json_object' } }),
			...(heat !== null && { temperature: heat }),
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
