import { editWebsiteDiff, WEBSITE_MODEL } from '@avenos/skills/composer'
import { deployHost, deploySite, tigrisStorageFromEnv } from '@avenos/skills/composer/publish'
import {
	assembleSystemContext,
	type RouterRequest,
	routeSkill,
	TOOL_ACTORS
} from '@avenos/skills/tools'
import { actorConfig, chatToolDefinitionsFor, skillManifest, skillMenu } from './config'
import { registerContextProvider, resolveContext } from './context'
import type { Context } from 'hono'
import { auth } from './auth'
import { TIERS } from './billing'
import { ensureSession, getSessionMessages, listSessions, persistMessage } from './chat'
import { crud, runCodeActor, runNamedOp } from './actor-run'
import { creditStatus, FIXED_ALLOWANCE_USD } from './credits'
import { schemasPromptHint } from './data'
import { db } from './db'
import { publish } from './events'
import { listMockups, mockupCaps } from './mockup-caps'
import { promoteCaps, promoteVibe, promotionStatusLines } from './promote-caps'
import { ontologyCaps } from './ontology'
import { mutationCaps, queryCaps } from './query-caps'
import { recordActorRun } from './skills-run'
import { vibeExists } from './vibe-registry'
import { refreshVibeForSchema } from './vibe-refresh'
import { typeCaps } from './type-caps'
import { getRecentUsage, getUsageStats, recordUsage, type TokenUsage } from './usage'

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

// board 0119q — Tier-3 skill hints are MANIFEST CONFIG, not code branches: a skill declares
// `hint_providers` (resolved live per turn through the SAME context registry the UI reads) and/or
// `hint_static` (a fixed block) in skill.manifest. These two providers wrap the live-data
// assemblers the old hardcoded todos/skillify branches called.
registerContextProvider('todos_snapshot', async (uid) => ({
	kind: 'text',
	label: 'Live todos snapshot',
	text: await schemasPromptHint(uid).catch(() => ''),
	meta: { source: 'live data assembler — data.ts · schemasPromptHint()' }
}))
registerContextProvider('promotion_status', async (uid) => {
	const lines = await promotionStatusLines(uid).catch(() => [] as string[])
	return {
		kind: 'text',
		label: 'Mockups + promotion status',
		text: lines.length
			? `EXISTING MOCKUPS + PROMOTION STATUS (use the EXACT names; when the user continues a promotion, call the named next step — do NOT restart at plan_app):\n${lines.join('\n')}`
			: '',
		meta: { source: 'live data assembler — promote-caps.ts · promotionStatusLines()' }
	}
})
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

/**
 * Per-tool reply-style note (board 0075): attached to the RESULT of any tool that renders a card/view
 * (data_crud list, show_finances, show_website). The card already shows the data, so the model should
 * reply with one short sentence \u2014 NOT re-dump the data as prose/Markdown. Scoped to those tool calls,
 * not injected globally, so plain conversational turns keep their normal style.
 */
const CARD_REPLY_NOTE =
	'Reply with ONE short sentence confirming this \u2014 the card already shows the data. Do NOT re-list ' +
	'it as prose, bullet points, or a Markdown table unless the user explicitly asks.'

/**
 * Recover tool calls the model emitted as TEXT instead of a structured `tool_calls` field — gemma
 * does this in VISION mode (e.g. `_call:run_skill{skill: "doc-ingest"}`, optionally wrapped in
 * `<|tool_call>…<tool_call|>`). Without this, an image-turn tool call (like run_skill) would be lost.
 * Gated: only consulted when no structured call arrived but a clear `call:NAME{…}` marker is present. board 0089.
 */
function parseTextToolCalls(content: string): { id: string; name: string; args: string }[] {
	const out: { id: string; name: string; args: string }[] = []
	const re = /call:\s*(\w+)\s*(\{[\s\S]*?\})/g
	let m: RegExpExecArray | null
	let n = 0
	while ((m = re.exec(content)) !== null) {
		let args: Record<string, unknown> = {}
		try {
			// lenient: quote unquoted keys + normalize single quotes → JSON
			const jsonish = m[2].replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"')
			args = JSON.parse(jsonish) as Record<string, unknown>
		} catch {
			args = {}
		}
		out.push({ id: `txt_${n++}`, name: m[1], args: JSON.stringify(args) })
	}
	return out
}

/**
 * Guarantee a tool-call's `arguments` are valid JSON before we echo the assistant turn back to Tinfoil.
 * gemma sometimes streams a TRUNCATED tool call (e.g. an unterminated string when it hits a token cap or
 * multi-item op); forwarding that raw makes the NEXT round 400 ("Unterminated string…") and kills the
 * whole stream. Re-serialize a lenient parse; if it's unsalvageable, fall back to `{}` so the tool just
 * reports an error and the model can retry — never a hard 400. board 0099.
 */
function sanitizeToolArgs(raw: string): string {
	const s = raw || '{}'
	try {
		JSON.parse(s)
		return s
	} catch {
		try {
			const repaired = s.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"')
			JSON.parse(repaired)
			return repaired
		} catch {
			return '{}'
		}
	}
}

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
		/** Current public/ files of the active spark, for the edit_website tool (GLM). board 0055. */
		publicFiles?: Record<string, string>
		/** File attachments from the client: base64 data + MIME type for multimodal classification. */
		attachments?: { mimeType: string; b64: string }[]
		/** Content hashes of the source files persisted to the PRIVATE store (mainnet). board 0082. */
		fileHashes?: string[]
	} | null
	const messages = body?.messages
	if (!Array.isArray(messages) || messages.length === 0) {
		return c.json({ error: 'messages[] required' }, 400)
	}
	const wantStream = body?.stream === true
	const userId = session.user.id
	const model = body?.model ?? TINFOIL_MODEL
	const publicFiles =
		body?.publicFiles && typeof body.publicFiles === 'object'
			? (body.publicFiles as Record<string, string>)
			: {}
	const attachments = Array.isArray(body?.attachments)
		? (body.attachments as { mimeType: string; b64: string }[]).filter(
				(a) => typeof a.mimeType === 'string' && typeof a.b64 === 'string'
			)
		: []
	const fileHashes = Array.isArray(body?.fileHashes)
		? (body.fileHashes as string[]).filter((h) => typeof h === 'string')
		: []

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
		return streamWithTools({
			key,
			model,
			messages,
			userId,
			chatSessionId,
			publicFiles,
			attachments,
			fileHashes
		})
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
	publicFiles: Record<string, string>
	attachments: { mimeType: string; b64: string }[]
	fileHashes?: string[]
}): Response {
	const { key, model, messages, userId, chatSessionId, publicFiles, attachments } = opts
	const fileHashes = opts.fileHashes ?? []
	const encoder = new TextEncoder()
	// When the client disconnects (its idle-abort, or navigating away) the stream is cancelled and any
	// further controller.enqueue throws "Controller is already closed". That throw, from a non-awaited
	// callback (e.g. a long GLM edit's keep-alive ping), is uncaught and CRASHES the bun server — which
	// made every later chat request fail with "Load failed". Guard every emit so a late write is a
	// no-op, and flip `cancelled` in the stream's cancel() hook. board 0056.
	let cancelled = false
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const emit = (obj: unknown) => {
				if (cancelled) return
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
				} catch {
					cancelled = true // controller closed (client gone) — stop emitting
				}
			}
			// Bubble tool-loop activity to the client so the chat shows which tools run + finish — and,
			// for long tools (GLM edits), the periodic 'running' re-emit keeps the stream alive. 0055.
			const emitTool = (
				id: string,
				name: string,
				detail: string,
				status: 'running' | 'done' | 'error'
			) => emit({ aven_tool: { id, name, detail, status } })
			// PERF (board 0105): the client sends the FULL session history, and Tinfoil re-prefills every
			// message each round — an ever-growing prompt is the dominant chat cost. Cap the context to the
			// last SESSION_CONTEXT_LIMIT conversational messages (the leading system message, if any, is
			// always kept — it carries the instructions + the schema hint merge below). Server-side tool
			// rounds aren't in this client history (they're persisted separately), so slicing is safe.
			const SESSION_CONTEXT_LIMIT = 5
			const hist = messages as { role?: string }[]
			const lead = hist[0]?.role === 'system' ? [hist[0]] : []
			const convo = lead.length ? hist.slice(1) : hist
			const msgs: unknown[] = [...lead, ...convo.slice(-SESSION_CONTEXT_LIMIT)]
			// Inject image attachments as multimodal content into the last user message so the
			// vision model (Gemma 4 31B) can see them — needed for classify_document. board 0063.
			if (attachments.length > 0) {
				const lastUserIdx = [...msgs]
					.reverse()
					.findIndex((m) => (m as { role?: string }).role === 'user')
				if (lastUserIdx >= 0) {
					const realIdx = msgs.length - 1 - lastUserIdx
					const lastUser = msgs[realIdx] as { role: string; content: string | unknown[] }
					const imageBlocks = attachments
						.filter((a) => a.mimeType.startsWith('image/'))
						.map((a) => ({
							type: 'image_url',
							image_url: { url: `data:${a.mimeType};base64,${a.b64}` }
						}))
					if (imageBlocks.length > 0) {
						const textContent =
							typeof lastUser.content === 'string'
								? lastUser.content
								: (lastUser.content as { type: string; text?: string }[])
										.filter((b) => b.type === 'text')
										.map((b) => b.text ?? '')
										.join('\n')
						msgs[realIdx] = {
							role: 'user',
							content: [{ type: 'text', text: textContent }, ...imageBlocks]
						}
					}
				}
			}
			let assistant = ''
			let promptTokens = 0
			let completionTokens = 0
			const emittedVibes = new Set<string>()
			// Running copy of the website files for this turn — each edit_website merges its changed
			// files into THIS, so edits compound across files + calls. Seeded from the client. board 0055.
			const turnFiles: Record<string, string> = { ...publicFiles }
			try {
				// board 0106 — DISPATCH (Tier 1): a tiny SCHEMA-FREE gemma call routes this turn to ONE skill,
				// so only that skill's tools enter context below (Tier 2) and its heavy context loads lazily
				// (Tier 3). Any error falls back to the default skill inside routeSkill, so routing never
				// blocks a turn. The router carries no tool schemas / no hint — it stays cheap on purpose.
				const routerCall = async (req: RouterRequest): Promise<string> => {
					const r = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
						method: 'POST',
						headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
						body: JSON.stringify(req)
					})
					if (!r.ok) throw new Error(`router ${r.status}`)
					const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
					return j.choices?.[0]?.message?.content ?? ''
				}
				const lastUser = [...msgs]
					.reverse()
					.find((m) => (m as { role?: string }).role === 'user') as
					| { content?: string | { type: string; text?: string }[] }
					| undefined
				const routeText =
					typeof lastUser?.content === 'string'
						? lastUser.content
						: (lastUser?.content ?? [])
								.filter(
									(b): b is { type: string; text?: string } =>
										typeof b === 'object' && b.type === 'text'
								)
								.map((b) => b.text ?? '')
								.join(' ')
				// board 0106 — surface the router as its own state chip (like a tool call) so the roundtrip
				// stays transparent: the user sees `dispatch → todos` flip running→done, not a silent gap
				// before the first tool badge. One stable chip id per turn (toolActivity resets each turn).
				emitTool('dispatch', 'dispatch', 'routing…', 'running')
				// board 0110 — the router menu + advertised tools now come from the DB skill/actor registries
				// (config-as-data), not hardcoded TS; both fall back to the TS seed if the tables are empty.
				// board 0119q — the router SCAFFOLD PROMPT too: DB actor `dispatch` (skill dispatch).
				const [menu, dispatchCfg] = await Promise.all([
					skillMenu(),
					actorConfig('dispatch').catch(() => null)
				])
			// board 0113 — the router sees the conversation TAIL (last few user/assistant turns) so
				// continuations route by understanding, not keywords.
				const tail = (messages as { role?: string; content?: unknown }[])
					.filter(
						(m) =>
							(m.role === 'user' || m.role === 'assistant') &&
							typeof m.content === 'string' &&
							!m.content.startsWith(VIBE_MARKER) // persisted card markers are payload, not talk
					)
					.slice(-5, -1)
					.map((m) => `${m.role}: ${String(m.content).slice(0, 200)}`)
					.join('\n')
				const skillId = await routeSkill(
					routerCall,
					routeText,
					model,
					menu,
					tail || undefined,
					dispatchCfg?.prompt ?? undefined
				)
				emitTool('dispatch', 'dispatch', `→ ${skillId}`, 'done')
				console.log(`[ai] dispatch → ${skillId}`)
				// board 0114 — the route decision itself is observable: one trace per turn naming the
				// chosen skill (absorbs board 0109).
				void recordActorRun(userId, {
					flowId: 'dispatch',
					nodeId: 'route',
					label: `→ ${skillId}`,
					outputs: [skillId]
				})
				// Tier 2 — resolve the routed skill's actors' mailboxes ONCE (same every round). board 0110.
				const toolDefs = await chatToolDefinitionsFor(skillId)
				// board 0113 — HARD tool-set enforcement: only the routed skill's advertised tools may run
				// this turn. Without it a hallucinated call executed ANY inline handler ("nochmal" routed to
				// todos, gemma invented edit_website, and GLM started rewriting the WEBSITE mid-promotion).
				const advertisedSet = new Set(toolDefs.map((d) => d.function.name))

				// board 0119q — the BASE system prompt is DB config too (actor `chat` on the dispatch
				// skill); the client's SYSTEM_PROMPT constant is only the seed/fallback when the row is
				// absent. Server-enforced so the prompt is editable + transparent like any actor's.
				const baseCfg = await actorConfig('chat').catch(() => null)
				if (baseCfg?.prompt) {
					const base = msgs[0] as { role?: string; content?: string } | undefined
					if (base?.role === 'system') base.content = baseCfg.prompt
					else msgs.unshift({ role: 'system', content: baseCfg.prompt })
				}
				// Tier 3 — per-skill context hints are MANIFEST CONFIG (board 0119q), not code branches:
				// the routed skill's manifest declares `hint_providers` (resolved live through the SAME
				// context registry the config UI reads — what the LLM gets IS what the panel shows) and/or
				// `hint_static`. MERGE into the leading system message — a SECOND system message makes
				// Tinfoil 400. board 0055 / 0106 / 0113.
				const manifest = await skillManifest(skillId).catch(() => null)
				const hintParts: string[] = []
				for (const providerKey of manifest?.hint_providers ?? []) {
					const p = await resolveContext(providerKey, userId).catch(() => null)
					if (p?.text) hintParts.push(p.text)
				}
				if (manifest?.hint_static) hintParts.push(manifest.hint_static)
				const hint = hintParts.join('\n')
				if (hint) {
					const first = msgs[0] as { role?: string; content?: string } | undefined
					if (first?.role === 'system') {
						first.content = assembleSystemContext(skillId, first.content ?? '', hint)
					} else {
						msgs.unshift({ role: 'system', content: hint })
					}
				}
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
							body: JSON.stringify({
								model,
								messages: msgs,
								tools: toolDefs,
								stream: true
							}),
							signal: ac.signal
						})
					} catch {
						clearTimeout(idle)
						emit({ choices: [{ delta: { content: '\n[ai timed out — please retry]' } }] })
						break
					}
					if (!res.ok || !res.body) {
						clearTimeout(idle)
						const detail = await res.text().catch(() => '')
						console.error(`[ai] tinfoil ${res.status} (round ${round}):`, detail.slice(0, 400))
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
					let callList = Object.values(calls)
					// gemma vision mode sometimes emits tool calls as TEXT — recover them so they dispatch.
					if (callList.length === 0 && /call:\s*\w+\s*\{/.test(roundContent)) {
						callList = parseTextToolCalls(roundContent)
					}
					if (callList.length === 0) break // model gave its final answer (already streamed)
					// Repair any truncated/malformed tool-call JSON BEFORE echoing the turn back — a raw
					// unterminated string 400s the next Tinfoil round + kills the stream. board 0099.
					for (const tc of callList) tc.args = sanitizeToolArgs(tc.args)
					// PERF (board 0105): count tool calls whose actor already produced the human reply (its
					// `response`). If EVERY call this round self-replied, we skip the next round — a whole
					// stateless re-prefill of the system prompt + tools + growing convo just to regenerate a
					// sentence the model already wrote. Halves latency on the common write/list turn.
					let selfReplied = 0
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
							/* leave empty; crud() will report the error */
						}
						// board 0113 — the enforcement gate: an un-advertised tool call NEVER executes.
						if (!advertisedSet.has(tc.name)) {
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({
									ok: false,
									error: `tool "${tc.name}" is not available on the current skill (${skillId}). Use only the advertised tools.`
								})
							})
							emitTool(tc.id, tc.name, 'not on this skill', 'error')
							continue
						}
						// board 0099 — REGISTRY DISPATCH: a chat tool is an actor (config+behavior) in
						// @avenos/skills/tools. data_crud (the whole Todos hub) routes here; the loop stays generic —
						// new tool = one module + one registry line, no loop edit. Server caps are injected via ctx.
						const actor = TOOL_ACTORS[tc.name]
						if (actor) {
							// Show the tool chip + start its timer BEFORE running the actor — a mint can take ~50s —
							// and keep the stream + timer alive with a 5s ping (else the client's 90s idle watchdog
							// aborts a long tool). One chip per tool_call id; re-emitting 'running' updates it. board 0100.
							const runDetail =
								[parsed.action, parsed.schema]
									.filter((x) => typeof x === 'string' && x)
									.join(' ') || tc.name
							emitTool(tc.id, tc.name, runDetail, 'running')
							const ping = setInterval(() => emitTool(tc.id, tc.name, runDetail, 'running'), 5_000)
							const out = await actor
								.handle(
									{
										userId,
										data: (a) => crud(userId, a),
										ops: (n, p) => runNamedOp(userId, n, p ?? {}), // board 0112 — named-op cap (e.g. the goals aggregate)
										ontology: ontologyCaps(userId), // board 0100 — GLM mint + data_schema registry caps
										query: queryCaps(userId), // board 0101 — GLM-authored validated query specs
										mutate: mutationCaps(userId), // board 0101 — GLM-authored validated mutation specs
										bundle: typeCaps(userId), // board 0102 — GLM-authored composite types (data_bundles)
										// board 0115 — GLM mockup authoring streams its raw tokens into the SAME live
										// panel the website skill uses (no dead "Thinking…" during a mint/refine).
										mockup: mockupCaps((text) => emit({ aven_edit_chunk: { text } })),
										// board 0113/0117 — stepwise promotion + connectors; authoring tokens stream
									// into the SAME live panel the mockup/website edits use (no dead "Thinking…").
									promote: promoteCaps(userId, (text) => emit({ aven_edit_chunk: { text } }))
									},
									parsed
								)
								.finally(() => clearInterval(ping))
							if (out.hitl) {
								// HITL: show a confirm/decline card and DON'T execute (the delete actor). aiConfirmAction runs it.
								emit({
									aven_hitl: {
										id: tc.id,
										tool: tc.name,
										label: out.hitl.label,
										action: out.hitl.action
									}
								})
								msgs.push({
									role: 'tool',
									tool_call_id: tc.id,
									content: JSON.stringify(out.content)
								})
								emitTool(tc.id, tc.name, out.detail ?? tc.name, 'done')
								continue
							}
							msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out.content) })
							if (out.reply) {
								emit({ choices: [{ delta: { content: out.reply } }] })
								assistant += out.reply
								selfReplied++
							}
							// The actor decides WHICH vibe(s) (todos → its mode card; skillify steps → the
							// stepper + the step's content card). The loop does the plumbing + dedup — keyed
							// by schema+data so an IDENTICAL re-emit is dropped but a newer state (the same
							// stepper at a later step) still renders.
							const vibes = out.vibe ? (Array.isArray(out.vibe) ? out.vibe : [out.vibe]) : []
							for (const v of vibes) {
								const key = `${v.schema}\n${v.data === undefined ? '' : JSON.stringify(v.data)}`
								if (emittedVibes.has(key)) continue
								emittedVibes.add(key)
								// a schema without vibe rows (e.g. a promoted skill's raw entity type) gets NO
								// card — the text reply stands; never a client-side "konnte nicht geladen" error.
								if (!(await vibeExists(v.schema).catch(() => true))) continue
								const { schema, data } = v
								emit({ aven_vibe: data === undefined ? { schema } : { schema, data } })
								await persistMessage(
									chatSessionId,
									'assistant',
									data === undefined
										? `${VIBE_MARKER}${schema}`
										: `${VIBE_MARKER}${schema}\n${JSON.stringify(data)}`
								).catch((e) => console.error('[ai] persist vibe marker failed:', e))
							}
							// board 0114 — GENERIC tracing at the ONE dispatch seam: every executed tool call
							// records a run keyed by the ROUTED skill + the actor (tool) name — no per-skill
							// schema-prefix sniffing, so a config-minted skill is traced from birth.
							const traceVibe = vibes[vibes.length - 1]
							void recordActorRun(userId, {
								flowId: skillId,
								nodeId: tc.name,
								label: out.detail ?? tc.name,
								vibe: traceVibe?.schema,
								vibeData: traceVibe?.data,
								outputs: [traceVibe?.schema ?? skillId]
							})
							emitTool(tc.id, tc.name, out.detail ?? tc.name, 'done')
							continue
						}
						// board 0113 — a DB-ONLY actor with sandboxed `code` is a FIRST-CLASS chat tool: no TS
						// handler exists (the skill was minted as pure config), so resolve the actor row by name
						// and run its QuickJS code with ONLY its granted caps. The state it returns feeds its
						// vibe card directly (the example-source contract). The 0111 seat, finally occupied.
						const dbActor = TOOL_ACTORS[tc.name] ? null : await actorConfig(tc.name)
						if (dbActor?.code) {
							emitTool(tc.id, tc.name, 'sandbox', 'running')
							const ping2 = setInterval(() => emitTool(tc.id, tc.name, 'sandbox', 'running'), 5_000)
							try {
								const run = await runCodeActor(dbActor, parsed, userId)
								const state = run.ran ? (run.result as Record<string, unknown>) : null
								msgs.push({
									role: 'tool',
									tool_call_id: tc.id,
									content: JSON.stringify({ ok: !!state, note: CARD_REPLY_NOTE })
								})
								const schema = dbActor.vibe
								if (state && schema && !emittedVibes.has(schema)) {
									emittedVibes.add(schema)
									emit({ aven_vibe: { schema, data: state } })
									await persistMessage(
										chatSessionId,
										'assistant',
										`${VIBE_MARKER}${schema}\n${JSON.stringify(state)}`
									).catch((e) => console.error('[ai] persist sandbox vibe failed:', e))
								}
								const saidReply =
									typeof parsed.response === 'string' && parsed.response.trim()
										? parsed.response.trim()
										: `Here is your ${String(schema ?? tc.name).replace(/-/g, ' ')}.`
								emit({ choices: [{ delta: { content: saidReply } }] })
								assistant += saidReply
								selfReplied++
								void recordActorRun(userId, {
									flowId: skillId,
									nodeId: tc.name,
									label: `sandbox ${tc.name}`,
									vibe: schema ?? undefined,
									vibeData: state ?? undefined,
									outputs: [schema ?? skillId]
								})
								emitTool(tc.id, tc.name, 'done', 'done')
							} catch (e) {
								msgs.push({
									role: 'tool',
									tool_call_id: tc.id,
									content: JSON.stringify({
										ok: false,
										error: e instanceof Error ? e.message : String(e)
									})
								})
								emitTool(tc.id, tc.name, 'sandbox error', 'error')
							} finally {
								clearInterval(ping2)
							}
							continue
						}
						// Read-only website viewer: flow the Composer vibe into the chat — no data op, so
						// the data_crud (todos etc.) path is untouched. board 0055.
						if (tc.name === 'show_website') {
							emitTool(tc.id, 'show_website', 'opening website viewer', 'running')
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({
									ok: true,
									shown: 'website composer (read-only)',
									note: CARD_REPLY_NOTE
								})
							})
							if (!emittedVibes.has('composer')) {
								emittedVibes.add('composer')
								emit({ aven_vibe: { schema: 'composer' } })
								await persistMessage(chatSessionId, 'assistant', `${VIBE_MARKER}composer`).catch(
									(e) => console.error('[ai] persist composer vibe marker failed:', e)
								)
							}
							emitTool(tc.id, 'show_website', 'website viewer ready', 'done')
							continue
						}
						// Website edit: the chat model passed an instruction — GLM returns SEARCH/REPLACE diff
						// blocks, applied here to the turn's running html (compounds across edits). Relayed to
						// the client (it writes via tauriFs + re-renders the Composer vibe). board 0055.
						if (tc.name === 'edit_website') {
							const instruction = typeof parsed.instruction === 'string' ? parsed.instruction : ''
							// Show which files GLM is reading up front; onProgress then streams the per-file detail.
							const reading = Object.keys(turnFiles)
								.map((p) => p.replace(/^public\//, ''))
								.join(', ')
							let editDetail = reading
								? `read ${reading} · glm-5-2 thinking…`
								: 'glm-5-2 starting a new site…'
							emitTool(tc.id, 'edit_website', editDetail, 'running')
							// Keep the chat stream alive during GLM prefill (no tokens yet) with a status ping.
							const ping = setInterval(
								() => emitTool(tc.id, 'edit_website', editDetail, 'running'),
								5_000
							)
							let applied = 0
							let failed = 0
							let changedFiles: Record<string, string> = {}
							try {
								const edit = await editWebsiteDiff(
									key,
									turnFiles,
									instruction,
									(detail) => {
										editDetail = detail
										emitTool(tc.id, 'edit_website', detail, 'running')
									},
									// Live feed of GLM's reasoning + diff text → a streaming activity panel. board 0056.
									(text) => emit({ aven_edit_chunk: { text } })
								)
								applied = edit.applied
								failed = edit.failed
								changedFiles = edit.files
								Object.assign(turnFiles, edit.files)
								if (edit.usage) {
									// Bill the GLM edit at GLM's price, separate from the chat model's turn.
									await recordUsage(userId, WEBSITE_MODEL, edit.usage).catch((e) =>
										console.error('[ai] recordUsage (website) failed:', e)
									)
								}
							} catch (e) {
								console.error('[ai] website edit (glm) failed:', e)
							} finally {
								clearInterval(ping)
							}
							const ok = applied > 0
							const names = Object.keys(changedFiles).map((p) => p.replace(/^src\//, ''))
							emitTool(
								tc.id,
								'edit_website',
								ok ? `updated ${names.join(', ')}` : 'edit failed',
								ok ? 'done' : 'error'
							)
							if (ok) emit({ aven_edit: { files: changedFiles } })
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({ ok, applied, failed, files: Object.keys(changedFiles) })
							})
							if (ok && !emittedVibes.has('composer')) {
								emittedVibes.add('composer')
								emit({ aven_vibe: { schema: 'composer' } })
								await persistMessage(chatSessionId, 'assistant', `${VIBE_MARKER}composer`).catch(
									(e) => console.error('[ai] persist composer vibe marker failed:', e)
								)
							}
							continue
						}
						// Publish to the live web: NEVER deploy without explicit confirmation — show a confirm
						// card carrying the spark's src + host; the upload runs in aiConfirmAction (admin-gated)
						// on confirm. Like the delete HITL, but for the website. board 0058.
						if (tc.name === 'deploy_website') {
							const host = deployHost()
							emit({
								aven_hitl: {
									id: tc.id,
									tool: 'deploy_website',
									label: `Publish your site to ${host.replace(/^https?:\/\//, '')}?`,
									action: { tool: 'deploy_website', src: turnFiles, host }
								}
							})
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({
									ok: false,
									status: 'awaiting_user_confirmation',
									note: 'A publish confirm card was shown. Do NOT deploy or retry — just tell the user you asked them to confirm publishing.'
								})
							})
						}
					}
					// PERF (board 0105): every tool call this round already emitted its own reply → the
					// answer is fully streamed and the card shows the result. Skip the extra round (a full
					// stateless re-prefill of prompt+tools+convo just to restate what the model already said).
					// query / HITL / website narration don't self-reply, so they still get a follow-up round.
					if (selfReplied > 0 && selfReplied === callList.length) break
				}
			} catch (e) {
				emit({
					choices: [{ delta: { content: `\n[ai error: ${e instanceof Error ? e.message : e}]` } }]
				})
			} finally {
				if (!cancelled) {
					try {
						controller.enqueue(encoder.encode('data: [DONE]\n\n'))
						controller.close()
					} catch {
						/* client already disconnected */
					}
				}
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
		},
		cancel() {
			// Client disconnected (idle-abort / navigation). Stop all further emits so no late write
			// throws on the closed controller and crashes the process. board 0056.
			cancelled = true
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

/** Session-gated: the caller's most recent completions (per-request tokens + USD cost). */
export async function aiUsageRecent(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	return c.json({ recent: await getRecentUsage(session.user.id) })
}

/**
 * HITL: run a data action the user explicitly confirmed (e.g. a delete the model proposed and
 * which the tool loop deliberately did NOT execute). Session-gated; crud() publishes a
 * `data` event so the live vibe refreshes. board 0055.
 */
export async function aiConfirmAction(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	const body = (await c.req.json().catch(() => null)) as { action?: Record<string, unknown> } | null
	if (!body?.action || typeof body.action !== 'object') {
		return c.json({ error: 'action required' }, 400)
	}
	// Publish to the live web — ADMIN-ONLY (same gate as set-tier), reusing the spark's src carried in
	// the confirm action. The Tigris creds live in the server env; never reach the client. board 0058.
	if (body.action.tool === 'deploy_website') {
		if ((session.user as { role?: string }).role !== 'admin') {
			return c.json({ ok: false, error: 'admin_only' }, 403)
		}
		const src = body.action.src
		if (!src || typeof src !== 'object') return c.json({ ok: false, error: 'no_site' }, 400)
		const storage = tigrisStorageFromEnv()
		if (!storage) return c.json({ ok: false, error: 'deploy_not_configured' }, 503)
		const host = typeof body.action.host === 'string' ? body.action.host : undefined
		try {
			const r = await deploySite(src as Record<string, string>, storage, { host })
			return c.json({ ok: true, result: { deployed: r.count, url: r.url } })
		} catch (e) {
			return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502)
		}
	}
	// board 0113/0117 — a CONFIRMED promote: copy the mock vibes live (first promote or a redesign).
	if (body.action.tool === 'promote_skill') {
		const app = String(body.action.app ?? '').trim()
		if (!app) return c.json({ ok: false, error: 'no_app' }, 400)
		try {
			await promoteVibe(app)
			void recordActorRun(session.user.id, {
				flowId: 'skillify',
				nodeId: 'promote',
				label: `promote ${app}`,
				outputs: [app]
			})
			return c.json({ ok: true, result: { app } })
		} catch (e) {
			return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
		}
	}
	// board 0101 — a confirmed destructive MUTATION: apply the (already validated + stored) mutation spec as
	// one transaction and record the run. The tool loop deliberately did NOT run it.
	if (body.action.tool === 'mutate') {
		const spec = body.action.spec
		const request = typeof body.action.request === 'string' ? body.action.request : 'mutation'
		if (!spec || typeof spec !== 'object') return c.json({ ok: false, error: 'no_spec' }, 400)
		try {
			const result = await mutationCaps(session.user.id).apply(spec as never)
			void recordActorRun(session.user.id, {
				flowId: 'ontology',
				nodeId: 'mutate',
				label: `mutate — ${request}`,
				vibe: 'mutation-result',
				vibeData: { request, spec, ops: result.ops },
				outputs: ['ops']
			})
			return c.json({
				ok: true,
				result: { vibe: 'mutation-result', data: { request, spec, ops: result.ops } }
			})
		} catch (e) {
			return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
		}
	}
	try {
		const result = await crud(session.user.id, body.action as Parameters<typeof crud>[1])
		// board 0114 — a confirmed delete records GENERICALLY for any schema (the schema name doubles as
		// the owning skill id for data hubs); todos keeps its deleted-summary card vibe.
		if (body.action.action === 'delete') {
			const schema = String(body.action.schema ?? 'data')
			const items = Array.isArray(body.action._deleted)
				? (body.action._deleted as { id: string; title: string }[])
				: []
			void recordActorRun(session.user.id, {
				flowId: schema,
				nodeId: 'data_crud',
				label: items.length > 1 ? `delete ${items.length} ${schema}` : `delete ${schema}`,
				...(schema === 'todos' ? { vibe: 'todos-deleted', vibeData: { items } } : {}),
				outputs: [schema]
			})
			// REALTIME: return the skill's refreshed vibe so the caller (voice/chat) updates the
			// stage right after the confirmed delete — for ANY schema (todos, shift→dienstplan …).
			const vibe = await refreshVibeForSchema(session.user.id, schema).catch(() => null)
				if (vibe) return c.json({ ok: true, result, vibe })
		}
		return c.json({ ok: true, result })
	} catch (e) {
		return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
	}
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
	// Valid tiers: free, the comp tiers (early-bird), or a wired Polar tier. board 0055.
	const valid =
		body?.tier === 'free' ||
		(body?.tier !== undefined && (body.tier in TIERS || body.tier in FIXED_ALLOWANCE_USD))
	if (!body?.userId || !valid) {
		const allowed = ['free', ...Object.keys(FIXED_ALLOWANCE_USD), ...Object.keys(TIERS)].join('|')
		return c.json({ error: `userId and tier (${allowed}) required` }, 400)
	}
	await db().updateTable('user').set({ tier: body.tier }).where('id', '=', body.userId).execute()
	return c.json({ ok: true, userId: body.userId, tier: body.tier })
}
