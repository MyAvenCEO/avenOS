import {
	BOOKING_SCHEMA,
	type BookingPick,
	type BookingRecord,
	buildBookingRecord
} from '@avenos/aven-vibes/booking'
import { getDoctype } from '@avenos/aven-vibes/doctypes'
import {
	bestInvoiceMatch,
	buildMatchRecord,
	type InvoiceMatch,
	invoiceTotal,
	invoiceVendor,
	MATCH_SCHEMA
} from '@avenos/aven-vibes/match'
import { skrForPrompt } from '@avenos/aven-vibes/skr'
import { CHAT_TOOLS } from '@avenos/aven-vibes/tools'
import {
	bankStatementToTransactions,
	newTransactions,
	TX_SCHEMA,
	type TxRecord
} from '@avenos/aven-vibes/tx'
import { editWebsiteDiff, WEBSITE_MODEL } from '@avenos/skills/composer'
import { deployHost, deploySite, tigrisStorageFromEnv } from '@avenos/skills/composer/publish'
import type { Context } from 'hono'
import { auth } from './auth'
import { TIERS } from './billing'
import { ensureSession, getSessionMessages, listSessions, persistMessage } from './chat'
import { creditStatus, FIXED_ALLOWANCE_USD } from './credits'
import { ensureDocSchema, executeDataTool, schemasPromptHint } from './data'
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
	}).catch(() => null)
	if (!res?.ok) return null
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[]
	} | null
	const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
	if (!args) return null
	try {
		const parsed = JSON.parse(args)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

/**
 * board 0065 — fan a bank statement's transactions out into the user's `tx` schema/table,
 * idempotently: skip any dedup_key we already stored (so re-extracting the same statement adds
 * nothing). Returns the count of NEW transactions stored.
 */
async function fanOutTransactions(
	userId: string,
	extracted: Record<string, unknown>,
	sourceValueId: string | null
): Promise<number> {
	const txs = bankStatementToTransactions(extracted, sourceValueId)
	if (txs.length === 0) return 0
	await ensureDocSchema(userId, 'tx', TX_SCHEMA)
	const existing = (await executeDataTool(userId, { schema: 'tx', action: 'list' })) as {
		items?: { dedup_key?: string }[]
	}
	const seen = new Set(
		(existing.items ?? []).map((i) => i.dedup_key).filter((k): k is string => typeof k === 'string')
	)
	const fresh = newTransactions(txs, seen)
	if (fresh.length === 0) return 0
	const res = (await executeDataTool(userId, {
		schema: 'tx',
		action: 'create',
		items: fresh as unknown as Record<string, unknown>[]
	})) as { created?: string[] }
	return res.created?.length ?? 0
}

/**
 * board 0066 — reconcile an extracted invoice against the user's stored `tx` records: query the tx
 * table, find the best paying transaction (amount-required), and persist a `match` row. Returns the
 * match (for the invoice-match vibe) or null when nothing reconciles.
 */
async function matchInvoiceAgainstTx(
	key: string,
	model: string,
	userId: string,
	extracted: Record<string, unknown>,
	invoiceValueId: string | null
): Promise<InvoiceMatch | null> {
	const listed = (await executeDataTool(userId, { schema: 'tx', action: 'list' })) as {
		items?: Record<string, unknown>[]
	}
	const txs = (listed.items ?? []) as unknown as TxRecord[]
	// DYNAMIC matching: let the model reconcile (handles cross-currency USD/EUR via original_amount,
	// fuzzy amounts/fees, vendor naming, date proximity). Fall back to the deterministic matcher.
	let match = await matchInvoiceLLM(key, model, extracted, txs)
	if (!match) match = bestInvoiceMatch(extracted, txs)
	try {
		await ensureDocSchema(userId, 'match', MATCH_SCHEMA)
		const record = buildMatchRecord(invoiceValueId, extracted, match)
		await executeDataTool(userId, {
			schema: 'match',
			action: 'create',
			items: [record as unknown as Record<string, unknown>]
		})
	} catch (e) {
		console.error('[ai] match persist failed:', e)
	}
	return match
}

/**
 * Dynamic invoice↔tx reconciliation: a focused tool call where the model picks the paying
 * transaction from the candidate list. It reasons about CROSS-CURRENCY payments (a USD invoice paid
 * as a EUR debit — match the tx `original_amount`/`original_currency`), small FX fees, vendor naming
 * in the Verwendungszweck, and date proximity. Returns an InvoiceMatch or null. board 0066/0069.
 */
async function matchInvoiceLLM(
	key: string,
	model: string,
	invoice: Record<string, unknown>,
	txs: TxRecord[]
): Promise<InvoiceMatch | null> {
	if (txs.length === 0) return null
	const target = invoiceTotal(invoice)
	const hdr =
		invoice.header && typeof invoice.header === 'object'
			? (invoice.header as Record<string, unknown>)
			: {}
	// Line-item / title text helps bridge vendor↔product naming (e.g. invoice vendor
	// "ActiveCampaign, LLC" → tx "POSTMARKAPP.COM"; "Cursor" → "CURSOR, AI POWERED IDE").
	const stmts = Array.isArray(invoice.statements) ? invoice.statements : []
	const lineText = stmts
		.flatMap((s) => {
			const li = s && typeof s === 'object' ? (s as Record<string, unknown>).line_items : null
			return Array.isArray(li) ? li : []
		})
		.map((li) => {
			const r = li && typeof li === 'object' ? (li as Record<string, unknown>) : {}
			return [r.title, r.description].filter((x) => typeof x === 'string').join(' ')
		})
		.filter(Boolean)
		.join(' · ')
		.slice(0, 400)
	const invSummary = {
		vendor: invoiceVendor(invoice),
		total: target,
		currency: typeof hdr.currency === 'string' ? hdr.currency : null,
		invoice_number: typeof hdr.invoice_number === 'string' ? hdr.invoice_number : null,
		order_number: typeof hdr.order_number === 'string' ? hdr.order_number : null,
		date: typeof hdr.issue_date === 'string' ? hdr.issue_date : null,
		line_items: lineText
	}
	const candidates = txs.slice(0, 400).map((t) => ({
		dedup_key: t.dedup_key,
		date: t.booking_date ?? t.value_date,
		amount: t.amount,
		currency: t.currency,
		original_amount: t.original_amount,
		original_currency: t.original_currency,
		counterparty: t.counterparty_name ?? t.counterparty_iban,
		// the description usually carries the merchant name AND an FX rate like "1 EUR = 1,1783 USD"
		description: t.description
	}))
	const tool = {
		type: 'function',
		function: {
			name: 'pick_match',
			description: 'Record which transaction paid the invoice (or none).',
			parameters: {
				type: 'object',
				properties: {
					tx_dedup_key: {
						type: ['string', 'null'],
						description: 'dedup_key of the paying transaction, or null if none plausibly matches.'
					},
					confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
					reason: {
						type: 'string',
						description: 'One short sentence (German) explaining the choice.'
					}
				},
				required: ['tx_dedup_key', 'confidence', 'reason']
			}
		}
	}
	const system =
		'You are a German bookkeeping assistant. Pick the SINGLE bank transaction that PAID this ' +
		'invoice, or NONE.\n' +
		'- AMOUNT first: the tx (an outgoing debit, usually negative) should equal the invoice total. ' +
		'CROSS-CURRENCY: a USD invoice paid as a EUR debit — compare the tx original_amount/' +
		'original_currency, or apply the FX rate often printed in the description (e.g. "1 EUR = ' +
		'1,1783 USD"). Allow small FX fees / rounding (about ±3%).\n' +
		'- VENDOR: the invoice vendor or its product/brand should appear in the tx counterparty or ' +
		'description (e.g. "ActiveCampaign"<->"POSTMARKAPP", "Cursor"<->"CURSOR"); use line_items.\n' +
		'- DATE: the payment is usually on/after the invoice date, within a few weeks.\n' +
		'Call pick_match with the tx dedup_key, or null if nothing plausibly matches.'
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: system },
				{
					role: 'user',
					content: `Invoice:\n${JSON.stringify(invSummary)}\n\nTransactions:\n${JSON.stringify(candidates)}`
				}
			],
			tools: [tool],
			tool_choice: { type: 'function', function: { name: 'pick_match' } },
			stream: false
		})
	}).catch(() => null)
	if (!res?.ok) return null
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[]
	} | null
	const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
	if (!args) return null
	let pick: { tx_dedup_key?: string | null; confidence?: string; reason?: string } | null = null
	try {
		pick = JSON.parse(args)
	} catch {
		return null
	}
	const matchedKey = typeof pick?.tx_dedup_key === 'string' ? pick.tx_dedup_key : null
	if (!matchedKey) return null
	const tx = txs.find((x) => x.dedup_key === matchedKey)
	if (!tx) return null
	const confidence: InvoiceMatch['confidence'] =
		pick?.confidence === 'high' ? 'high' : pick?.confidence === 'none' ? 'none' : 'medium'
	if (confidence === 'none') return null
	return { tx, confidence, reasons: pick?.reason ? [pick.reason] : [], target: target ?? 0 }
}

async function bookInvoice(
	key: string,
	model: string,
	userId: string,
	invoice: Record<string, unknown>,
	match: InvoiceMatch | null,
	invoiceValueId: string | null
): Promise<BookingRecord | null> {
	const hdr =
		invoice.header && typeof invoice.header === 'object'
			? (invoice.header as Record<string, unknown>)
			: {}
	const invSummary = {
		vendor: invoiceVendor(invoice),
		total: invoiceTotal(invoice),
		currency: typeof hdr.currency === 'string' ? hdr.currency : null,
		invoice_number: typeof hdr.invoice_number === 'string' ? hdr.invoice_number : null,
		date: typeof hdr.issue_date === 'string' ? hdr.issue_date : null,
		booking_summary: typeof invoice.booking_summary === 'string' ? invoice.booking_summary : null,
		totals: invoice.totals ?? null,
		statements: invoice.statements ?? null
	}
	const paidVia = match
		? {
				konto_hint: '1800',
				amount: match.tx.amount,
				date: match.tx.booking_date ?? match.tx.value_date,
				text: match.tx.description
			}
		: null
	const tool = {
		type: 'function',
		function: {
			name: 'book_invoice',
			description:
				'Record the SKR04 Buchungssatz for this invoice. Use a Splitbuchung (multiple `lines`) ' +
				'when the invoice mixes VAT rates, cost types, private/business shares, or Skonto.',
			parameters: {
				type: 'object',
				properties: {
					lines: {
						type: 'array',
						minItems: 1,
						description:
							'The EXPENSE (Soll) positions — NET only. ONE line for a simple invoice; MULTIPLE ' +
							'lines (a Splitbuchung) when positions need different EXPENSE accounts or VAT rates. ' +
							'Do NOT add a Vorsteuer/VAT line and do NOT pick a VAT account — the system posts the ' +
							'Abziehbare Vorsteuer automatically from each position net + tax_treatment.',
						items: {
							type: 'object',
							properties: {
								soll_konto: {
									type: 'string',
									description:
										'SKR04 EXPENSE/asset konto for THIS position (4 digits, EXACTLY as in the chart). NOT a VAT account.'
								},
								net_amount: {
									type: ['number', 'null'],
									description:
										'NET amount of this position (ohne USt). If only gross is known, set gross_amount instead.'
								},
								gross_amount: {
									type: ['number', 'null'],
									description:
										'Gross of this position — only if net is not separately known; the system derives net + VAT.'
								},
								tax_treatment: {
									type: 'string',
									enum: ['vat_19', 'vat_7', 'reverse_charge', 'intra_eu', 'none'],
									description:
										'VAT treatment of THIS position: vat_19 / vat_7 = domestic German input VAT (system posts Abziehbare Vorsteuer 1406/1401); reverse_charge = §13b foreign supplier; intra_eu = innergemeinschaftlicher Erwerb; none = steuerfrei / no deductible VAT.'
								},
								cost_treatment: {
									type: ['string', 'null'],
									enum: ['standard', 'bewirtung', null],
									description:
										'Set "bewirtung" for a RESTAURANT / entertainment receipt (Bewirtungsbeleg, "Bewirtete Personen"): the system books the §4 Abs.5 EStG 70/30 split (6640 abziehbar + 6644 nicht abziehbar) with full Vorsteuer — pass the FULL net + vat_19. Otherwise "standard" or omit.'
								},
								note: {
									type: ['string', 'null'],
									description: 'Short German label of what this position is (e.g. "Druckerpapier").'
								}
							},
							required: ['soll_konto', 'tax_treatment']
						}
					},
					haben_konto: {
						type: 'string',
						description:
							'Credit/contra account: the bank/payment konto it was paid from (e.g. 1800 Bank), 4 digits from the chart.'
					},
					buchungstext: {
						type: ['string', 'null'],
						description: 'Short German Buchungstext (vendor + what it is).'
					},
					confidence: {
						type: 'string',
						enum: ['high', 'medium', 'low'],
						description:
							'Your confidence in the chosen ACCOUNT(s): high = the standard/obvious konto for this Vorgang; medium = plausible but some judgement; low = unsure or a fallback account. Rate it honestly.'
					},
					reason: {
						type: 'string',
						description: 'One short German sentence justifying the account choice(s).'
					}
				},
				required: ['lines', 'haben_konto', 'confidence', 'reason']
			}
		}
	}
	const system =
		'You are a German bookkeeper booking ONE incoming supplier invoice into the SKR04 chart. ' +
		'For EACH EXPENSE position choose the best Soll expense/asset account — rely especially on ' +
		'`booking_summary` (a bookkeeper-oriented description of the Leistung/Vorgang), plus the vendor + ' +
		'line items; e.g. software/SaaS subscriptions → an IT/software-costs account, hosting → ' +
		'IT/communication costs. The CREDIT (Haben) is the account it was paid from — use 1800 (Bank) ' +
		'unless context says otherwise. Pick every konto STRICTLY from the provided SKR04 chart (exact ' +
		'4-digit konto).\n\n' +
		'AMOUNTS + VAT: give each position as NET (net_amount, ohne USt) plus a `tax_treatment`. Do NOT ' +
		'add a Vorsteuer line and do NOT pick a VAT/Umsatzsteuer account — the system posts the ' +
		'Abziehbare Vorsteuer (SKR04 1406 for 19%, 1401 for 7%) AUTOMATICALLY from net + tax_treatment, ' +
		'so the Buchungssatz balances. tax_treatment: vat_19 / vat_7 = normal domestic German input VAT; ' +
		'reverse_charge = §13b foreign supplier (no deductible input VAT in the payment); intra_eu = ' +
		'innergemeinschaftlicher Erwerb; none = steuerfrei or a non-EU supplier billing without VAT.\n\n' +
		'SPLITBUCHUNG: emit MULTIPLE expense `lines` when ONE invoice mixes different VAT rates (7% vs ' +
		'19%), different cost types (Bürobedarf + Reinigung + Bewirtung → separate konten), or private ' +
		'vs business shares. For a simple single-rate invoice, emit exactly ONE expense line.\n\n' +
		'BEWIRTUNG: a RESTAURANT bill / entertainment receipt (Restaurantrechnung, Bewirtungsbeleg, a ' +
		'"Bewirtete Personen" field, food & drinks) → ONE line with cost_treatment "bewirtung", the FULL ' +
		'net, tax_treatment vat_19, soll_konto 6640. The system applies the §4 Abs.5 EStG 70/30 split ' +
		'(6640 + 6644) and the full Vorsteuer itself — do not split it yourself.\n\n' +
		'ALWAYS pick the single best-fitting SKR04 expense account for a clear business expense and call ' +
		'book_invoice — never return without an account. If genuinely unsure, use the closest sonstige ' +
		'betrieblicher Aufwand konto rather than nothing, and set `confidence` to "low".\n\n' +
		'CONFIDENCE: rate `confidence` honestly for how sure you are about the ACCOUNT choice — "high" ' +
		'for an obvious/standard konto, "medium" when it needed judgement, "low" for a guess/fallback.'
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: system },
				{
					role: 'user',
					content: `SKR04 chart (konto<TAB>bezeichnung):\n${skrForPrompt()}\n\nInvoice summary (lean on booking_summary to pick the account):\n${JSON.stringify(invSummary)}\n\nFull invoice JSON:\n${JSON.stringify(invoice)}\n\nPaid via:\n${JSON.stringify(paidVia)}`
				}
			],
			tools: [tool],
			tool_choice: { type: 'function', function: { name: 'book_invoice' } },
			stream: false
		})
	}).catch(() => null)
	let pick: BookingPick | null = null
	if (res?.ok) {
		const data = (await res.json().catch(() => null)) as {
			choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[]
		} | null
		const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
		if (args) {
			try {
				pick = JSON.parse(args) as BookingPick
			} catch {
				pick = null
			}
		}
	}
	const record = buildBookingRecord(invoiceValueId, invoice, pick)
	try {
		await ensureDocSchema(userId, 'booking', BOOKING_SCHEMA)
		await executeDataTool(userId, {
			schema: 'booking',
			action: 'create',
			items: [record as unknown as Record<string, unknown>]
		})
	} catch (e) {
		console.error('[ai] booking persist failed:', e)
	}
	return record
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
			attachments
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
}): Response {
	const { key, model, messages, userId, chatSessionId, publicFiles, attachments } = opts
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
			}> => {
				const doctype = getDoctype(docTypeName)
				emitTool(tcId, 'extract_document', docTypeName || 'document', 'running')
				let extracted: Record<string, unknown> | null = null
				let stored = false
				let txAdded = 0
				let createdId: string | null = null
				let invoiceMatch: InvoiceMatch | null = null
				let invoiceBooking: BookingRecord | null = null
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
						try {
							await ensureDocSchema(userId, docTypeName, doctype.schema)
							const result = (await executeDataTool(userId, {
								schema: docTypeName,
								action: 'create',
								items: [extracted]
							})) as { ok?: boolean; created?: string[] }
							stored = result?.ok === true
							createdId = result?.created?.[0] ?? null
							if (docTypeName === 'bank_statement') {
								txAdded = await fanOutTransactions(userId, extracted, createdId)
							}
							if (docTypeName === 'invoice') {
								invoiceMatch = await matchInvoiceAgainstTx(key, model, userId, extracted, createdId)
								invoiceBooking = await bookInvoice(
									key,
									model,
									userId,
									extracted,
									invoiceMatch,
									createdId
								)
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
				if (extracted && docTypeName === 'invoice' && !emittedVibes.has('invoice-booking')) {
					emittedVibes.add('invoice-booking')
					const hdr =
						extracted.header && typeof extracted.header === 'object'
							? (extracted.header as Record<string, unknown>)
							: {}
					const currency = typeof hdr.currency === 'string' ? hdr.currency : ''
					const ibData = {
						invoice: extracted,
						match: invoiceMatch,
						booking: invoiceBooking,
						currency
					}
					emit({ aven_vibe: { schema: 'invoice-booking', data: ibData } })
					await persistMessage(
						chatSessionId,
						'assistant',
						`${VIBE_MARKER}invoice-booking\n${JSON.stringify(ibData)}`
					).catch((e) => console.error('[ai] persist invoice-booking vibe marker failed:', e))
				}
				return {
					extracted: !!extracted,
					stored,
					txAdded,
					match: invoiceMatch
						? { status: 'matched', confidence: invoiceMatch.confidence }
						: docTypeName === 'invoice'
							? { status: 'unmatched' }
							: undefined
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
												note: 'Extraction already ran automatically — do NOT call extract_document. Reply with one short sentence.'
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
									? { extracted: true, stored: true, txAdded: 0, match: undefined }
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
									match: summary.match
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
