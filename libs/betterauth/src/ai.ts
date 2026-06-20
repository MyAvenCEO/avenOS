import { DATA_TOOLS } from '@avenos/aven-vibes/tools'
import type { Context } from 'hono'
import { auth } from './auth'
import { TIERS } from './billing'
import { ensureSession, getSessionMessages, listSessions, persistMessage } from './chat'
import { creditStatus } from './credits'
import { executeDataTool, schemasPromptHint } from './data'
import { db } from './db'
import { publish } from './events'
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
// Max time a streaming round may go without receiving any bytes before we abort it (a stalled
// upstream must not wedge the stream open forever). Resets on every chunk. board 0055.
const STREAM_IDLE_MS = 60_000

/**
 * Sentinel content for a persisted vibe-card marker message: `<ZWSP>aven-vibe:<schema>`.
 * A real assistant reply never starts with this, and the zero-width space keeps it
 * Postgres-text-safe (no null bytes). The client re-hydrates it into a vibe card and
 * never sends it back to the model. board 0054.
 */
export const VIBE_MARKER = '\u200baven-vibe:'

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

	// Hard credit cap: block inference once the tier's weekly allowance is spent. board 0052.
	const credit = await creditStatus(userId)
	if (credit.remainingUsd <= 0) {
		return c.json(
			{
				error: 'out_of_credits',
				tier: credit.tier,
				allowanceUsd: credit.allowanceUsd,
				spentUsd: credit.spentUsd
			},
			402
		)
	}

	// Persist the new user turn (the last user message) into the caller's session.
	const lastUserText =
		[...(messages as { role?: string; content?: string }[])]
			.reverse()
			.find((m) => m.role === 'user')?.content ?? ''
	const chatSessionId = await ensureSession(userId, body?.sessionId, lastUserText)
	await persistMessage(chatSessionId, 'user', lastUserText).catch((e) =>
		console.error('[ai] persist user message failed:', e)
	)

	// Streaming path: run a tool loop (Tinfoil + the data_crud tool) and stream ONLY the
	// assistant's content to the client; tool calls (schema-validated CRUD on /api/data)
	// run server-side between rounds, transparent to the client. board 0054.
	if (wantStream) {
		return streamWithTools({ key, model, messages, userId, chatSessionId })
	}

	// Non-streaming fallback: a single completion, no tools.
	const upstream = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, messages, stream: false })
	}).catch((e) => {
		throw new Error(`tinfoil fetch failed: ${e instanceof Error ? e.message : String(e)}`)
	})
	if (!upstream.ok) {
		const detail = await upstream.text().catch(() => '')
		return c.json({ error: `tinfoil_error_${upstream.status}`, detail: detail.slice(0, 500) }, 502)
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
	publish(userId, { entity: 'usage' })
	return c.json({ content, usage: data.usage ?? null, sessionId: chatSessionId })
}

type ToolCallAcc = { id: string; name: string; args: string }
type StreamDelta = {
	content?: string
	tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
}

/**
 * Stream a completion to the client while running a server-side tool loop: each round
 * calls Tinfoil with the `data_crud` tool; content deltas are re-emitted to the client as
 * OpenAI-style SSE, tool calls are assembled and executed against the data store (scoped to
 * the user), their results fed back, until the model returns a final answer. board 0054.
 */
function streamWithTools(opts: {
	key: string
	model: string
	messages: unknown[]
	userId: string
	chatSessionId: string
}): Response {
	const { key, model, messages, userId, chatSessionId } = opts
	const encoder = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const emit = (obj: unknown) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
			const msgs: unknown[] = [...messages]
			let assistant = ''
			let promptTokens = 0
			let completionTokens = 0
			const emittedVibes = new Set<string>()
			try {
				// Tell the model the exact schema field names so data_crud writes validate.
				const hint = await schemasPromptHint(userId).catch(() => '')
				if (hint) msgs.unshift({ role: 'system', content: hint })
				for (let round = 0; round < 5; round++) {
					// Abort a round that stalls (no bytes for STREAM_IDLE_MS) so a hung Tinfoil upstream
					// can't wedge the whole stream open forever — that left the client stuck on
					// "Thinking…" with no [DONE], which also bricked every follow-up request. board 0055.
					const ac = new AbortController()
					let idle = setTimeout(() => ac.abort(), STREAM_IDLE_MS)
					const bumpIdle = (): void => {
						clearTimeout(idle)
						idle = setTimeout(() => ac.abort(), STREAM_IDLE_MS)
					}
					let res: Response
					try {
						res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
							method: 'POST',
							headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
							body: JSON.stringify({ model, messages: msgs, tools: DATA_TOOLS, stream: true }),
							signal: ac.signal
						})
					} catch {
						clearTimeout(idle)
						emit({ choices: [{ delta: { content: '\n[ai timed out — please retry]' } }] })
						break
					}
					if (!res.ok || !res.body) {
						clearTimeout(idle)
						emit({ choices: [{ delta: { content: `\n[ai error ${res.status}]` } }] })
						break
					}
					const reader = res.body.getReader()
					const decoder = new TextDecoder()
					let buf = ''
					const calls: Record<number, ToolCallAcc> = {}
					let roundContent = ''
					let roundPrompt = 0
					let roundCompletion = 0
					let interrupted = false
					try {
						while (true) {
							const { done, value } = await reader.read()
							if (done) break
							bumpIdle()
							buf += decoder.decode(value, { stream: true })
							const events = buf.split('\n\n')
							buf = events.pop() ?? ''
							for (const ev of events) {
								const line = ev.split('\n').find((l) => l.startsWith('data:'))
								if (!line) continue
								const payload = line.slice(5).trim()
								if (payload === '[DONE]') continue
								let json: { usage?: TokenUsage; choices?: { delta?: StreamDelta }[] }
								try {
									json = JSON.parse(payload)
								} catch {
									continue
								}
								if (json.usage) {
									roundPrompt = json.usage.prompt_tokens ?? roundPrompt
									roundCompletion = json.usage.completion_tokens ?? roundCompletion
								}
								const delta = json.choices?.[0]?.delta
								if (!delta) continue
								if (typeof delta.content === 'string' && delta.content) {
									roundContent += delta.content
									assistant += delta.content
									emit({ choices: [{ delta: { content: delta.content } }] })
								}
								for (const tc of delta.tool_calls ?? []) {
									const i = tc.index ?? 0
									let acc = calls[i]
									if (!acc) {
										acc = { id: '', name: '', args: '' }
										calls[i] = acc
									}
									if (tc.id) acc.id = tc.id
									if (tc.function?.name) acc.name = tc.function.name
									if (tc.function?.arguments) acc.args += tc.function.arguments
								}
							}
						}
					} catch {
						interrupted = true
					} finally {
						clearTimeout(idle)
					}
					if (interrupted) {
						emit({ choices: [{ delta: { content: '\n[ai stream interrupted — please retry]' } }] })
						break
					}
					promptTokens += roundPrompt
					completionTokens += roundCompletion
					const callList = Object.values(calls)
					if (callList.length === 0) break // model gave its final answer (already streamed)
					// Tool round: record the assistant tool-call turn, run each tool, feed results back.
					msgs.push({
						role: 'assistant',
						content: roundContent || null,
						tool_calls: callList.map((tc) => ({
							id: tc.id,
							type: 'function',
							function: { name: tc.name, arguments: tc.args }
						}))
					})
					for (const tc of callList) {
						let parsed: Record<string, unknown> = {}
						try {
							parsed = JSON.parse(tc.args || '{}')
						} catch {
							/* leave empty; executeDataTool will report the error */
						}
						let result: unknown
						try {
							result = await executeDataTool(userId, parsed)
						} catch (e) {
							result = { ok: false, error: e instanceof Error ? e.message : String(e) }
						}
						msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
						// Signal the client to flow a live vibe card for the touched schema into the
						// message stream (the same data this CRUD just changed), and persist a marker
						// message so the card reappears when the session is reloaded. One per schema
						// per turn. board 0054.
						if (
							typeof parsed.schema === 'string' &&
							parsed.schema &&
							!emittedVibes.has(parsed.schema)
						) {
							emittedVibes.add(parsed.schema)
							emit({ aven_vibe: { schema: parsed.schema } })
							await persistMessage(
								chatSessionId,
								'assistant',
								`${VIBE_MARKER}${parsed.schema}`
							).catch((e) => console.error('[ai] persist vibe marker failed:', e))
						}
					}
				}
			} catch (e) {
				emit({
					choices: [{ delta: { content: `\n[ai error: ${e instanceof Error ? e.message : e}]` } }]
				})
			} finally {
				controller.enqueue(encoder.encode('data: [DONE]\n\n'))
				controller.close()
				if (assistant) {
					await persistMessage(chatSessionId, 'assistant', assistant).catch((err) =>
						console.error('[ai] persist assistant (stream) failed:', err)
					)
				}
				await recordUsage(userId, model, {
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens
				}).catch((err) => console.error('[ai] recordUsage (stream) failed:', err))
				publish(userId, { entity: 'usage' })
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

/** Session-gated: the signed-in user's token usage (all-time + week) + tier credit status. */
export async function aiUsage(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	const [stats, credit] = await Promise.all([
		getUsageStats(session.user.id),
		creditStatus(session.user.id)
	])
	return c.json({ ...stats, credit })
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

/** Admin-gated: set a user's product tier (free | any wired tier). board 0052. */
export async function aiSetTier(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if ((session.user as { role?: string }).role !== 'admin') {
		return c.json({ error: 'forbidden' }, 403)
	}
	const body = (await c.req.json().catch(() => null)) as {
		userId?: string
		tier?: string
	} | null
	const valid = body?.tier === 'free' || (body?.tier !== undefined && body.tier in TIERS)
	if (!body?.userId || !valid) {
		return c.json({ error: `userId and tier (free|${Object.keys(TIERS).join('|')}) required` }, 400)
	}
	await db().updateTable('user').set({ tier: body.tier }).where('id', '=', body.userId).execute()
	return c.json({ ok: true, userId: body.userId, tier: body.tier })
}
