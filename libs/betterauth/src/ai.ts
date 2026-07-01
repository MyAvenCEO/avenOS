import { CONTACT_SCHEMA, contactDisplayName, mintContactId } from '@avenos/aven-vibes/contact'
import {
	enrichFields,
	matchContact,
	type PartyInput,
	partiesFromDoc,
	partyToContactFields
} from '@avenos/aven-vibes/contact-match'
import { loadExtractConfig } from './skills-run'
import {
	computeInvoiceTotals,
	INVOICE_DOC_SCHEMA,
	type InvoiceDoc,
	type InvoiceLine,
	requiredFieldsMissing
} from '@avenos/aven-vibes/invoice-doc'
import { assignInvoiceNumber, type InvoiceState } from '@avenos/aven-vibes/invoice-number'
import { CHAT_TOOLS } from '@avenos/aven-vibes/tools'
import { editWebsiteDiff, WEBSITE_MODEL } from '@avenos/skills/composer'
import { deployHost, deploySite, tigrisStorageFromEnv } from '@avenos/skills/composer/publish'
import type { Context } from 'hono'
import { auth } from './auth'
import { TIERS } from './billing'
import { ensureSession, getSessionMessages, listSessions, persistMessage } from './chat'
import { creditStatus, FIXED_ALLOWANCE_USD } from './credits'
import { ensureDocSchema, executeDataTool, schemasPromptHint } from './data'
import { runSkillForUser } from './skills-run'
import { db } from './db'
import { publish } from './events'
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
 * Full type-specific extraction (board 0064): a focused, non-streaming vision pass that forces the
 * model to fill the doctype's JSON Schema as a single tool, driven by the doctype's system prompt,
 * over the same rasterized page images the classify step saw. Returns the parsed fields or null.
 */
async function extractDocFields(
	key: string,
	model: string,
	doctype: { system_prompt: string; schema: Record<string, unknown> },
	attachments: { mimeType: string; b64: string }[]
): Promise<Record<string, unknown> | null> {
	const imageBlocks = attachments
		.filter((a) => a.mimeType.startsWith('image/'))
		.map((a) => ({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${a.b64}` } }))
	if (imageBlocks.length === 0) return null
	const tool = {
		type: 'function',
		function: {
			name: 'emit_fields',
			description: 'Return the extracted document fields matching the schema.',
			parameters: doctype.schema
		}
	}
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: doctype.system_prompt },
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Extract every field from this document.' },
						...imageBlocks
					]
				}
			],
			tools: [tool],
			tool_choice: { type: 'function', function: { name: 'emit_fields' } },
			stream: false
		})
	}).catch((e) => {
		console.error('[ai] extract vision fetch threw:', e)
		return null
	})
	if (!res?.ok) {
		const detail = res ? await res.text().catch(() => '') : 'no response'
		console.error(`[ai] extract vision HTTP ${res?.status ?? '???'}:`, detail.slice(0, 600))
		return null
	}
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[]
	} | null
	const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
	if (!args) {
		console.error(
			'[ai] extract vision: no tool_call args returned:',
			JSON.stringify(data).slice(0, 400)
		)
		return null
	}
	try {
		const parsed = JSON.parse(args)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
	} catch (e) {
		console.error('[ai] extract vision: tool args not JSON:', e, args.slice(0, 300))
		return null
	}
}

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
// board 0082 — outgoing invoicing helpers (pure shaping; the tool branches do the persist/emit).
const CONTACT_FIELD_KEYS = [
	'type',
	'name',
	'legal_form',
	'street',
	'zip',
	'city',
	'country',
	'vat_id',
	'tax_number',
	'email',
	'phone',
	'iban',
	'bic',
	'bank_name',
	'contact_person',
	'register_court',
	'register_number',
	'managing_director',
	'notes'
] as const

function contactFieldsFromPick(p: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const k of CONTACT_FIELD_KEYS) if (p[k] != null) out[k] = p[k]
	return out
}

function partyFromContact(c: Record<string, unknown> | null): Record<string, unknown> | null {
	if (!c) return null
	const pick = (k: string) => (typeof c[k] === 'string' && c[k] ? (c[k] as string) : null)
	return {
		name: pick('name'),
		legal_form: pick('legal_form'),
		street: pick('street'),
		zip: pick('zip'),
		city: pick('city'),
		country: pick('country'),
		vat_id: pick('vat_id'),
		tax_number: pick('tax_number'),
		iban: pick('iban'),
		bic: pick('bic'),
		bank_name: pick('bank_name'),
		register_court: pick('register_court'),
		register_number: pick('register_number'),
		managing_director: pick('managing_director')
	}
}

/**
 * board 0082 — after a doc extract, harvest its parties (vendor + buyer / account holder), match them
 * against the addressbook (USt-IdNr → IBAN → name), and create/enrich contacts. The buyer/account
 * holder is the user's SELF-company candidate: when none is marked yet, return a hint so the chat asks
 * "is this your company?" (answerable in free text → set_my_company). Returns the hint + touched count.
 */
async function enrichAddressbookFromDoc(
	userId: string,
	docType: string,
	extracted: Record<string, unknown>
): Promise<{ hint: string | null; touched: number }> {
	const { vendor, self } = partiesFromDoc(docType, extracted)
	if (!vendor?.name && !self?.name) return { hint: null, touched: 0 }
	await ensureDocSchema(userId, 'contact', CONTACT_SCHEMA)
	const contacts = ((
		(await executeDataTool(userId, { schema: 'contact', action: 'list' })) as {
			items?: Record<string, unknown>[]
		}
	).items ?? []) as (Record<string, unknown> & { id?: string })[]
	const hasSelf = contacts.some((c) => c.is_self)
	const ids = contacts.map((c) => String(c.short_id ?? '')).filter(Boolean)
	let touched = 0

	const upsert = async (
		party: PartyInput | undefined
	): Promise<{ id: string; name: string } | null> => {
		if (!party?.name) return null
		const match = matchContact(party, contacts)
		if (match?.id) {
			const patch = enrichFields(match, party)
			if (Object.keys(patch).length > 0) {
				await executeDataTool(userId, {
					schema: 'contact',
					action: 'update',
					items: [{ id: match.id, ...patch }]
				})
				touched++
			}
			return { id: match.id, name: String(match.name ?? party.name) }
		}
		const fields = partyToContactFields(party)
		const shortId = mintContactId(Math.random, ids)
		ids.push(shortId)
		const res = (await executeDataTool(userId, {
			schema: 'contact',
			action: 'create',
			items: [{ short_id: shortId, is_self: false, ...fields }]
		})) as { created?: string[] }
		const id = res.created?.[0] ?? ''
		if (id) {
			contacts.push({ id, short_id: shortId, ...(fields as Record<string, unknown>) })
			touched++
		}
		return id ? { id, name: String(fields.name ?? party.name) } : null
	}

	await upsert(vendor)
	const selfContact = await upsert(self)
	const hint =
		!hasSelf && selfContact
			? `Es ist noch keine eigene Firma (Stammdaten) gesetzt. Frage den Nutzer kurz, ob „${selfContact.name}" seine eigene Firma ist; wenn ja, rufe set_my_company(contact_value_id="${selfContact.id}") auf.`
			: null
	return { hint, touched }
}

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
			const msgs: unknown[] = [...messages]
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
			// The doc type already extracted this turn (auto-chained after classify, or via the
			// extract_document tool) — guards against a double extraction if the model also calls the
			// tool after we auto-ran it. board 0076.
			let extractedType: string | null = null
			// Run the full type-specific extraction for a classified doc (board 0064/0076): vision pass →
			// validate+persist → tx fan-out / invoice reconcile+book → emit doc-compare + booking cards.
			// Factored out so it runs BOTH when the model calls extract_document AND auto-chained right
			// after classify — so the extract step never silently fails to trigger.
			const performExtraction = async (
				docTypeName: string,
				tcId: string
			): Promise<{
				extracted: boolean
				stored: boolean
				txAdded: number
				match?: { status: string; confidence?: string }
				addressbookHint?: string | null
			}> => {
				const doctype = await loadExtractConfig(docTypeName) // board 0093: the flow-config SSOT
				emitTool(tcId, 'extract_document', docTypeName || 'document', 'running')
				let extracted: Record<string, unknown> | null = null
				let stored = false
				let txAdded = 0
				let createdId: string | null = null
					let addressbookHint: string | null = null
				if (doctype && attachments.length > 0) {
					// The 2nd vision pass can take 10–30s with no bytes; re-emit 'running' every 5s so the
					// client's idle watchdog doesn't abort the stream ("Fetch is aborted"). board 0064.
					const ping = setInterval(
						() => emitTool(tcId, 'extract_document', `${docTypeName} · extracting…`, 'running'),
						5_000
					)
					try {
						extracted = await extractDocFields(key, model, doctype, attachments)
					} finally {
						clearInterval(ping)
					}
					if (extracted) {
						// Stamp the source file's content hash (it was persisted to the PRIVATE store on the
						// client) into the extracted doc so the JSON references the original. board 0082.
						if (fileHashes[0]) extracted.file_hash = fileHashes[0]
						try {
							await ensureDocSchema(userId, docTypeName, doctype.schema)
							const result = (await executeDataTool(userId, {
								schema: docTypeName,
								action: 'create',
								items: [extracted]
							})) as { ok?: boolean; created?: string[] }
							stored = result?.ok === true
							createdId = result?.created?.[0] ?? null
							// board 0082 — harvest + match-make the doc's parties into the addressbook (the buyer /
							// account holder is the self-company candidate, surfaced via the returned hint).
							try {
								addressbookHint = (await enrichAddressbookFromDoc(userId, docTypeName, extracted))
									.hint
							} catch (e2) {
								console.error('[ai] addressbook enrich failed:', e2)
							}
						} catch (e) {
							console.error('[ai] extract persist failed:', e)
						}
					}
				}
				if (extracted) extractedType = docTypeName
				emitTool(
					tcId,
					'extract_document',
					stored
						? `${docTypeName} · stored${txAdded > 0 ? ` · +${txAdded} tx` : ''}`
						: docTypeName || 'document',
					extracted ? 'done' : 'error'
				)
				if (extracted && !emittedVibes.has('doc-compare')) {
					emittedVibes.add('doc-compare')
					const previewAtt = attachments.find((a) => a.mimeType.startsWith('image/'))
					const dcData = {
						type: docTypeName,
						extracted,
						fileUrl: previewAtt ? `data:${previewAtt.mimeType};base64,${previewAtt.b64}` : null,
						mimeType: previewAtt?.mimeType ?? null
					}
					emit({ aven_vibe: { schema: 'doc-compare', data: dcData } })
					await persistMessage(
						chatSessionId,
						'assistant',
						`${VIBE_MARKER}doc-compare\n${JSON.stringify(dcData)}`
					).catch((e) => console.error('[ai] persist doc-compare vibe marker failed:', e))
				}
				return {
					extracted: !!extracted,
					stored,
					txAdded,
					// board 0098 — reconciliation moved to the flow (matched≡mapti auto-match); the inline path
					// no longer reconciles against flat `tx`, so an extracted invoice is reported unmatched here.
					match: docTypeName === 'invoice' ? ({ status: 'unmatched' } as const) : undefined,
					addressbookHint
				}
			}
			// Running copy of the website files for this turn — each edit_website merges its changed
			// files into THIS, so edits compound across files + calls. Seeded from the client. board 0055.
			const turnFiles: Record<string, string> = { ...publicFiles }
			try {
				// Tell the model the exact schema field names so data_crud writes validate. MERGE the
				// hint into the existing leading system message — a SECOND system message makes Tinfoil
				// 400 (only the first turn worked, before any schema existed → no hint). board 0055.
				const hint = await schemasPromptHint(userId).catch(() => '')
				if (hint) {
					const first = msgs[0] as { role?: string; content?: string } | undefined
					if (first?.role === 'system') {
						first.content = `${first.content ?? ''}\n\n${hint}`.trim()
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
							body: JSON.stringify({ model, messages: msgs, tools: CHAT_TOOLS, stream: true }),
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
						// Run a skill on the attached document (board 0089): store the raw artifact, classify
						// via REAL vision, save a `document` with provenance — the generic runner, from chat.
						if (tc.name === 'run_skill') {
							const skill =
								typeof parsed.skill === 'string' && parsed.skill ? parsed.skill : 'doc-ingest'
							emitTool(tc.id, 'run_skill', `running ${skill}`, 'running')
							let toolResult: Record<string, unknown>
							try {
								const img = attachments.find((a) => a.mimeType.startsWith('image/'))
								if (!img) {
									toolResult = { ok: false, error: 'attach a document image to ingest' }
								} else {
									const out = await runSkillForUser(
										userId,
										skill,
										{
											bytes: new Uint8Array(Buffer.from(img.b64, 'base64')),
											mime: img.mimeType
										},
										// board 0091 — stream each step's vibe card into the chat (classification,
										// doc-compare, invoice-booking) as the flow runs.
										(step) => {
											if (!step.vibe || emittedVibes.has(step.vibe)) return
											emittedVibes.add(step.vibe)
											emit({ aven_vibe: { schema: step.vibe, data: step.vibeData } })
											void persistMessage(
												chatSessionId,
												'assistant',
												`${VIBE_MARKER}${step.vibe}\n${JSON.stringify(step.vibeData ?? {})}`
											).catch(() => {})
										}
									)
									toolResult = { ok: out.status === 'done', ...out, note: CARD_REPLY_NOTE }
								}
							} catch (e) {
								toolResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
							}
							msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
							emitTool(
								tc.id,
								'run_skill',
								toolResult.ok ? 'document filed' : 'skill failed',
								toolResult.ok ? 'done' : 'error'
							)
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
						// BWA / finance snapshot: flow the computed finance vibe into the chat. No data op —
						// the view is computed client-side from the user's bookings + tx. board 0072.
						if (tc.name === 'show_finances') {
							emitTool(tc.id, 'show_finances', 'opening finance snapshot', 'running')
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({
									ok: true,
									shown: 'finance snapshot (BWA)',
									note: CARD_REPLY_NOTE
								})
							})
							if (!emittedVibes.has('bwa')) {
								emittedVibes.add('bwa')
								emit({ aven_vibe: { schema: 'bwa' } })
								await persistMessage(chatSessionId, 'assistant', `${VIBE_MARKER}bwa`).catch((e) =>
									console.error('[ai] persist bwa vibe marker failed:', e)
								)
							}
							emitTool(tc.id, 'show_finances', 'finance snapshot ready', 'done')
							continue
						}
						// board 0082 — outgoing invoicing + addressbook tools. Contacts/invoices are JSON in /api/data;
						// the server mints contact ids, assigns fortlaufende numbers, computes VAT. PDF render is client-side.
						if (
							tc.name === 'upsert_contact' ||
							tc.name === 'set_my_company' ||
							tc.name === 'query_contacts' ||
							tc.name === 'create_invoice' ||
							tc.name === 'update_invoice' ||
							tc.name === 'set_invoice_state' ||
							tc.name === 'save_invoice_pdf'
						) {
							const reply = typeof parsed.response === 'string' ? parsed.response : ''
							emitTool(tc.id, tc.name, tc.name, 'running')
							let toolResult: Record<string, unknown> = { ok: true }
							const emitVibe = (schema: string, data?: unknown) => {
								emit({ aven_vibe: data === undefined ? { schema } : { schema, data } })
								const marker =
									data === undefined
										? `${VIBE_MARKER}${schema}`
										: `${VIBE_MARKER}${schema}\n${JSON.stringify(data)}`
								void persistMessage(chatSessionId, 'assistant', marker).catch(() => {})
							}
							try {
								await ensureDocSchema(userId, 'contact', CONTACT_SCHEMA)
								const listContacts = async (): Promise<Record<string, unknown>[]> =>
									(
										(await executeDataTool(userId, { schema: 'contact', action: 'list' })) as {
											items?: Record<string, unknown>[]
										}
									).items ?? []
								if (tc.name === 'query_contacts') {
									const items = await listContacts()
									emitVibe('addressbook')
									toolResult = { ok: true, count: items.length, note: CARD_REPLY_NOTE }
								} else if (tc.name === 'upsert_contact') {
									const fields = contactFieldsFromPick(parsed)
									const contacts = await listContacts()
									// Resolve the target: an explicit id, else DEDUPE against an existing contact
									// (USt-IdNr → IBAN → name) so we never create a duplicate. board 0082.
									let targetId =
										typeof parsed.contact_value_id === 'string' && parsed.contact_value_id
											? parsed.contact_value_id
											: (matchContact(fields as PartyInput, contacts)?.id ?? null)
									if (targetId) {
										await executeDataTool(userId, {
											schema: 'contact',
											action: 'update',
											items: [{ id: targetId, ...fields }]
										})
										toolResult = { ok: true, contact_value_id: targetId, updated: true }
									} else {
										const shortId = mintContactId(
											Math.random,
											contacts.map((c) => String(c.short_id ?? '')).filter(Boolean)
										)
										const res = (await executeDataTool(userId, {
											schema: 'contact',
											action: 'create',
											items: [{ short_id: shortId, is_self: false, ...fields }]
										})) as { created?: string[] }
										targetId = res.created?.[0] ?? null
										toolResult = { ok: true, contact_value_id: targetId, short_id: shortId }
									}
									emitVibe('addressbook')
								} else if (tc.name === 'set_my_company') {
									await executeDataTool(userId, {
										schema: 'contact',
										action: 'update',
										items: [{ id: parsed.contact_value_id, is_self: true }]
									})
									emitVibe('addressbook')
									toolResult = { ok: true, set: 'is_self' }
								} else {
									// invoice tools — need invoice_doc schema, the seller (my company), and existing numbers.
									await ensureDocSchema(userId, 'invoice_doc', INVOICE_DOC_SCHEMA)
									const contacts = await listContacts()
									const myCompany = contacts.find((c) => c.is_self) ?? null
									const invoices =
										(
											(await executeDataTool(userId, {
												schema: 'invoice_doc',
												action: 'list'
											})) as { items?: Record<string, unknown>[] }
										).items ?? []
									const numbers = invoices.map((i) => String(i.number ?? '')).filter(Boolean)
									const persistDoc = async (doc: InvoiceDoc) => {
										await executeDataTool(userId, {
											schema: 'invoice_doc',
											action: 'create',
											items: [doc as unknown as Record<string, unknown>]
										})
										emitVibe('invoice-create', doc)
									}
									if (tc.name === 'create_invoice') {
										// resolve the customer: existing contact, or create one from `customer`.
										let customer =
											typeof parsed.contact_value_id === 'string'
												? (contacts.find((c) => c.id === parsed.contact_value_id) ?? null)
												: null
										if (!customer && parsed.customer && typeof parsed.customer === 'object') {
											const cf = contactFieldsFromPick(parsed.customer as Record<string, unknown>)
											const shortId = mintContactId(
												Math.random,
												contacts.map((c) => String(c.short_id ?? '')).filter(Boolean)
											)
											const res = (await executeDataTool(userId, {
												schema: 'contact',
												action: 'create',
												items: [{ short_id: shortId, is_self: false, type: 'company', ...cf }]
											})) as { created?: string[] }
											customer = { id: res.created?.[0] ?? null, short_id: shortId, ...cf }
											emitVibe('addressbook')
										}
										const shortId = String(customer?.short_id ?? 'XXXXXXXX')
										const lines = (Array.isArray(parsed.lines) ? parsed.lines : []) as InvoiceLine[]
										const number = assignInvoiceNumber(numbers, 'entwurf', shortId)
										const doc: InvoiceDoc = {
											number,
											state: 'entwurf',
											version: 1,
											contact_short_id: shortId,
											contact_value_id: (customer?.id as string) ?? null,
											issue_date: typeof parsed.issue_date === 'string' ? parsed.issue_date : null,
											service_date: null,
											service_period:
												typeof parsed.service_period === 'string' ? parsed.service_period : null,
											seller: partyFromContact(myCompany) as InvoiceDoc['seller'],
											buyer: partyFromContact(customer) as InvoiceDoc['buyer'],
											lines,
											totals: computeInvoiceTotals(lines),
											currency: 'EUR',
											note: typeof parsed.note === 'string' ? parsed.note : null,
											pdf_file_hash: null,
											supersedes: null
										}
										await persistDoc(doc)
										const missing = requiredFieldsMissing(doc)
										toolResult = {
											ok: true,
											number,
											totals: doc.totals,
											my_company_set: !!myCompany,
											missing_required_fields: missing,
											note:
												missing.length || !myCompany
													? 'Ask the user (free text/voice) for the missing fields, then update_invoice / upsert the seller.'
													: CARD_REPLY_NOTE
										}
									} else if (tc.name === 'update_invoice') {
										const prior =
											invoices
												.filter((i) => i.number === parsed.number)
												.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null
										const base = (prior ?? {}) as unknown as InvoiceDoc
										const lines = (
											Array.isArray(parsed.lines) ? parsed.lines : (base.lines ?? [])
										) as InvoiceLine[]
										const doc: InvoiceDoc = {
											...base,
											version: Number(base.version ?? 0) + 1,
											issue_date:
												typeof parsed.issue_date === 'string'
													? parsed.issue_date
													: (base.issue_date ?? null),
											service_period:
												typeof parsed.service_period === 'string'
													? parsed.service_period
													: (base.service_period ?? null),
											note: typeof parsed.note === 'string' ? parsed.note : (base.note ?? null),
											lines,
											totals: computeInvoiceTotals(lines),
											pdf_file_hash: null,
											supersedes: String(parsed.number)
										}
										await persistDoc(doc)
										toolResult = {
											ok: true,
											number: doc.number,
											version: doc.version,
											totals: doc.totals,
											note: CARD_REPLY_NOTE
										}
									} else if (tc.name === 'set_invoice_state') {
										const prior =
											invoices
												.filter((i) => i.number === parsed.number)
												.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null
										const base = (prior ?? {}) as unknown as InvoiceDoc
										const state = parsed.state as InvoiceState
										const shortId = String(base.contact_short_id ?? 'XXXXXXXX')
										const number = assignInvoiceNumber(numbers, state, shortId)
										const doc: InvoiceDoc = {
											...base,
											number,
											state,
											version: 1,
											pdf_file_hash: null,
											supersedes: String(parsed.number)
										}
										await persistDoc(doc)
										toolResult = { ok: true, number, state, note: CARD_REPLY_NOTE }
									} else if (tc.name === 'save_invoice_pdf') {
										// The PDF is rendered client-side (HTML template → print). Flow the invoice card so the client
										// can render + store it in the PRIVATE file store and stamp the hash. board 0082 Phase E.
										const doc =
											invoices
												.filter((i) => i.number === parsed.number)
												.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null
										if (doc) emitVibe('invoice-create', doc)
										emit({ aven_invoice_pdf: { number: parsed.number } })
										toolResult = {
											ok: true,
											number: parsed.number,
											note: 'The client renders + stores the PDF.'
										}
									}
								}
							} catch (e) {
								toolResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
							}
							msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
							if (reply) {
								emit({ choices: [{ delta: { content: reply } }] })
								assistant += reply
							}
							emitTool(tc.id, tc.name, tc.name, 'done')
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
							continue
						}
						// Bookkeeping: classify_document — the model already determined the type and
						// metadata from the multimodal content. Emit the vibe card with that data. 0063.
						if (tc.name === 'classify_document') {
							const docType = typeof parsed.docType === 'string' ? parsed.docType : 'other'
							const title = typeof parsed.title === 'string' ? parsed.title : ''
							const description = typeof parsed.description === 'string' ? parsed.description : ''
							const booking_summary =
								typeof parsed.booking_summary === 'string' ? parsed.booking_summary : ''
							const tags = Array.isArray(parsed.tags) ? (parsed.tags as unknown[]).map(String) : []
							const issuer = typeof parsed.issuer === 'string' ? parsed.issuer : ''
							const recipient = typeof parsed.recipient === 'string' ? parsed.recipient : ''
							const parties = Array.isArray(parsed.parties)
								? (parsed.parties as unknown[]).map(String)
								: []
							const reply =
								typeof parsed.response === 'string' ? parsed.response : 'Dokument klassifiziert.'
							emitTool(tc.id, 'classify_document', `${docType}: ${title}`, 'running')
							if (!emittedVibes.has('bookkeeping')) {
								emittedVibes.add('bookkeeping')
								const previewAtt = attachments.find((a) => a.mimeType.startsWith('image/'))
								const bkData = {
									docType,
									title,
									description,
									booking_summary,
									tags,
									issuer,
									recipient,
									parties,
									fileUrl: previewAtt
										? `data:${previewAtt.mimeType};base64,${previewAtt.b64}`
										: null,
									mimeType: previewAtt?.mimeType ?? null
								}
								emit({ aven_vibe: { schema: 'bookkeeping', data: bkData } })
								// Persist the marker WITH its data + preview image so the card (and its thumbnail)
								// re-hydrate after reload. board 0067/0074.
								await persistMessage(
									chatSessionId,
									'assistant',
									`${VIBE_MARKER}bookkeeping\n${JSON.stringify(bkData)}`
								).catch((e) => console.error('[ai] persist bookkeeping vibe marker failed:', e))
							}
							emitTool(tc.id, 'classify_document', `${docType}: ${title}`, 'done')
							// Auto-chain the extract step (board 0076): the model sometimes classifies and then stops
							// without calling extract_document. For an extractable type with images, run extraction
							// here directly so it never silently fails to trigger.
							const extractable =
								(docType === 'invoice' || docType === 'bank_statement' || docType === 'contract') &&
								attachments.length > 0
							let autoExtract: Awaited<ReturnType<typeof performExtraction>> | null = null
							if (extractable && !extractedType) {
								autoExtract = await performExtraction(docType, `${tc.id}:extract`)
							}
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({
									ok: true,
									docType,
									title,
									description,
									tags,
									issuer,
									recipient,
									parties,
									...(autoExtract
										? {
												extracted: autoExtract.extracted,
												stored: autoExtract.stored,
												// Addressbook auto-enriched from the parties; the hint (if any) asks the user to
												// confirm their own company. Else: extraction already ran, reply briefly. board 0082.
												note:
													autoExtract.addressbookHint ??
													'Extraction already ran automatically — do NOT call extract_document. Reply with one short sentence.'
											}
										: {})
								})
							})
							emit({ choices: [{ delta: { content: reply } }] })
							assistant += reply
							continue
						}
						// Bookkeeping: extract_document — full type-specific extraction (factored into performExtraction,
						// also auto-chained after classify). Skip if classify already ran it for this type. board 0064/0076.
						if (tc.name === 'extract_document') {
							const docTypeName = typeof parsed.type === 'string' ? parsed.type : ''
							const reply =
								typeof parsed.response === 'string' ? parsed.response : 'Dokument extrahiert.'
							const summary =
								extractedType === docTypeName
									? {
											extracted: true,
											stored: true,
											txAdded: 0,
											match: undefined,
											addressbookHint: null as string | null
										}
									: await performExtraction(docTypeName, tc.id)
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({
									ok: !!summary.extracted,
									type: docTypeName,
									stored: summary.stored,
									validated: summary.stored,
									transactions_added: summary.txAdded,
									match: summary.match,
									// board 0082 — addressbook auto-enriched from the parties; when the user's own
									// company isn't set yet, this asks them to confirm it (free text).
									...(summary.addressbookHint ? { note: summary.addressbookHint } : {})
								})
							})
							emit({ choices: [{ delta: { content: reply } }] })
							assistant += reply
							continue
						}
						const dataDetail =
							`${typeof parsed.action === 'string' ? parsed.action : ''} ${typeof parsed.schema === 'string' ? parsed.schema : ''}`.trim() ||
							'data'
						// HITL: never DELETE without explicit confirmation — show a confirm/decline card and
						// DON'T execute. The user approves via /api/ai/confirm, which runs it. board 0055.
						if (parsed.action === 'delete') {
							const schema = typeof parsed.schema === 'string' ? parsed.schema : 'data'
							const id = typeof parsed.id === 'string' ? parsed.id : ''
							emit({
								aven_hitl: {
									id: tc.id,
									tool: 'data_crud',
									label: `Delete from "${schema}"${id ? ` (#${id.slice(0, 8)})` : ''}?`,
									action: parsed
								}
							})
							msgs.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({
									ok: false,
									status: 'awaiting_user_confirmation',
									note: 'A confirm/decline card was shown to the user. Do NOT delete or retry — just tell them you asked them to confirm.'
								})
							})
							continue
						}
						// board 0099 — the Todos skill is an actor hub. The edit actor shows a before→after
						// diff, so snapshot the affected rows BEFORE the write while we still can.
						let todosBefore: Record<string, Record<string, unknown>> | undefined
						if (parsed.schema === 'todos' && parsed.action === 'update') {
							const cur = (await executeDataTool(userId, {
								schema: 'todos',
								action: 'list'
							})) as { items?: Record<string, unknown>[] }
							todosBefore = Object.fromEntries((cur.items ?? []).map((r) => [String(r.id), r]))
						}
						emitTool(tc.id, tc.name || 'data_crud', dataDetail, 'running')
						let result: unknown
						try {
							result = await executeDataTool(userId, parsed)
						} catch (e) {
							result = { ok: false, error: e instanceof Error ? e.message : String(e) }
						}
						// A `list` renders a vibe card, so tell the model to answer tersely (don't re-dump the
						// rows as a Markdown table). Scoped to THIS tool result, not a global prompt. board 0075.
						const resultPayload =
							parsed.action === 'list' &&
							result &&
							typeof result === 'object' &&
							!Array.isArray(result)
								? { ...(result as Record<string, unknown>), note: CARD_REPLY_NOTE }
								: result
						msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultPayload) })
						emitTool(tc.id, tc.name || 'data_crud', dataDetail, 'done')
						// Signal the client to flow a live vibe card for the touched schema into the
						// message stream (the same data this CRUD just changed), and persist a marker
						// message so the card reappears when the session is reloaded. One per schema
						// per turn. board 0054.
						// board 0099 — the Todos skill is an ACTOR HUB: the create/edit actors stream their own
						// mode vibe showing ONLY what changed (created → new tasks, edited → updated + before→after
						// diff). Every other schema (incl. a plain todos `list` = the read actor) flows the full
						// live card. One vibe per schema/mode per turn; a marker is persisted so it survives reload.
						const todoItem = (o: Record<string, unknown>) => ({
							id: o.id as string | undefined,
							title: (o.title ?? o.task) as string | undefined,
							done: o.done as boolean | undefined,
							due: o.due as string | undefined,
							priority: o.priority as string | undefined
						})
						let vibeSchema = typeof parsed.schema === 'string' ? parsed.schema : ''
						let vibePayload: unknown
						if (parsed.schema === 'todos' && parsed.action === 'create') {
							vibeSchema = 'todos-created'
							const pItems = (parsed.items ?? []) as Record<string, unknown>[]
							vibePayload = { items: pItems.map((i) => todoItem(i)) }
						} else if (parsed.schema === 'todos' && parsed.action === 'update') {
							vibeSchema = 'todos-edited'
							const pItems = (parsed.items ?? []) as Record<string, unknown>[]
							const items = pItems.map((i) => todoItem(i))
							const diffs = pItems
								.map((patch) => {
									const before = (todosBefore ?? {})[String(patch.id)] ?? {}
									const changes = Object.keys(patch)
										.filter((k) => k !== 'id' && String(patch[k] ?? '') !== String(before[k] ?? ''))
										.map((k) => ({ field: k, from: String(before[k] ?? ''), to: String(patch[k] ?? '') }))
									return { id: String(patch.id), title: String(before.title ?? patch.title ?? ''), changes }
								})
								.filter((d) => d.changes.length > 0)
							vibePayload = { items, diffs }
						}
						if (vibeSchema && !emittedVibes.has(vibeSchema)) {
							emittedVibes.add(vibeSchema)
							emit({ aven_vibe: vibePayload === undefined ? { schema: vibeSchema } : { schema: vibeSchema, data: vibePayload } })
							await persistMessage(
								chatSessionId,
								'assistant',
								vibePayload === undefined
									? `${VIBE_MARKER}${vibeSchema}`
									: `${VIBE_MARKER}${vibeSchema}\n${JSON.stringify(vibePayload)}`
							).catch((e) => console.error('[ai] persist vibe marker failed:', e))
						}
					}
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
 * which the tool loop deliberately did NOT execute). Session-gated; executeDataTool publishes a
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
	try {
		const result = await executeDataTool(session.user.id, body.action)
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
