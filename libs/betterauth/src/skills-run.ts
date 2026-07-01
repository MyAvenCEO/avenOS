import { randomUUID } from 'node:crypto'
import {
	type ActorRegistry,
	type ArtifactStore,
	type Flow,
	flattenFlow,
	type FlowRun,
	runFlow,
	type TraceStep
} from '@avenos/aven-skills'
import type { Context } from 'hono'
import { pgArtifactStore } from './artifact-store'
import { auth } from './auth'
import { db } from './db'
import { executeDataTool, loadTypeSpec } from './data'

// Skill execution (board 0089). Loads a skill's Flow config from the admin `flow` table, runs it
// through the GENERIC runner with doc-ingest's actors injected, stores the raw bytes in the
// ArtifactStore, classifies via REAL gemma4-31b vision, and persists the result as `document`
// predications + krasi/finti provenance via the 0088 engine + the run trace to `flow_run`. The
// runner is generic; only doc-ingest's actors are implemented (other skills = add an actor).

const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
const TINFOIL_MODEL = process.env.TINFOIL_MODEL ?? 'gemma4-31b'

async function userId(c: Context): Promise<string | null> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	return session?.user?.id ?? null
}

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

/** A skill input artifact: the raw bytes + mime of the file/photo to ingest. */
export type SkillInput = { bytes: Uint8Array; mime: string }

const CLASSIFY_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string', description: 'A short human title for the document.' },
		kind: {
			type: 'string',
			enum: ['invoice', 'bank_statement', 'contract', 'other'],
			description: 'The document type.'
		},
		summary: { type: 'string', description: 'A one-sentence summary of the document.' }
	},
	required: ['title', 'kind', 'summary']
}

/** A real gemma4-31b vision pass: force the model to fill CLASSIFY_SCHEMA as a single tool over the
 *  page image. Returns the parsed fields, or null on any failure (the actor falls back to "other"). */
async function visionExtract(
	systemPrompt: string,
	schema: Record<string, unknown>,
	image: { mime: string; b64: string }
): Promise<Record<string, unknown> | null> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return null
	const res = await fetch(`${TINFOIL_BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: TINFOIL_MODEL,
			messages: [
				{ role: 'system', content: systemPrompt },
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Classify this document.' },
						{ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.b64}` } }
					]
				}
			],
			tools: [
				{
					type: 'function',
					function: {
						name: 'emit',
						description: 'Return the extracted fields matching the schema.',
						parameters: schema
					}
				}
			],
			tool_choice: { type: 'function', function: { name: 'emit' } },
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
		return JSON.parse(args) as Record<string, unknown>
	} catch {
		return null
	}
}

/** The skills' actors, closing over the ArtifactStore + the acting user. The `document` resource carries
 *  the bytes between ingest→classify/extract (for vision); only the sha256 is persisted. board 0089/0090.
 *  board 0093: extraction is CONFIG-DRIVEN — `extract_document` reads the node's system_prompt + schema
 *  (the SSOT), so one actor extracts any doctype; `enrichAddressbook` links the contact graph. */
function skillActors(store: ArtifactStore, uid: string): ActorRegistry {
	return {
		storeDocument: async ({ inputs }) => {
			const file = (inputs.file ?? inputs.image) as SkillInput | undefined
			if (!file) throw new Error('storeDocument: no file/image input')
			const sha = await store.put(file.bytes, file.mime)
			return { document: { artifact: sha, mime: file.mime, bytes: file.bytes } }
		},
		classify_document: async ({ node, inputs }) => {
			const doc = inputs.document as { artifact: string; mime: string; bytes: Uint8Array }
			const b64 = Buffer.from(doc.bytes).toString('base64')
			const sys =
				node.system_prompt ??
				'Determine the document type: invoice, bank_statement, contract or other. Return a title, kind and a short summary.'
			const fields = (await visionExtract(sys, CLASSIFY_SCHEMA, { mime: doc.mime, b64 })) ?? {
				title: 'Untitled document',
				kind: 'other',
				summary: ''
			}
			return {
				// preserve bytes+mime so a downstream step (composite flows, e.g. invoice extract after
				// classify) can still run vision; the persistence ignores them — only the sha256 lands.
				document: {
					artifact: doc.artifact,
					mime: doc.mime,
					bytes: doc.bytes,
					title: fields.title,
					// board 0097: the doc type is kind≡tcita whose x1 (label) is a stable doctype REF, so we
					// emit `doctype-<kind>` (the vibe strips the prefix for display).
					kind: `doctype-${fields.kind || 'other'}`,
					summary: fields.summary
				}
			}
		},
		// GENERIC extractor (board 0093): the system prompt + tool-call schema come from the NODE config
		// (the SSOT), so this one actor extracts ANY doctype — invoice, bank_statement, … — no per-type
		// code. Emits the raw extraction under the node's output kind; `enrichAddressbook` maps + persists.
		extract_document: async ({ node, inputs }) => {
			const doc = inputs.document as { artifact: string; mime: string; bytes: Uint8Array } | undefined
			if (!doc?.bytes) throw new Error('extract_document: no document input')
			const sys = node.system_prompt
			const schema = node.schema as Record<string, unknown> | undefined
			if (!sys || !schema) throw new Error('extract_document: node is missing system_prompt/schema (the SSOT)')
			const b64 = Buffer.from(doc.bytes).toString('base64')
			const raw = (await visionExtract(sys, schema, { mime: doc.mime, b64 })) ?? {}
			const kind = node.outputs[0] ?? 'document'
			return { [kind]: { ...raw, artifact: doc.artifact } }
		},
		// ENRICH (board 0093): from the raw invoice extraction — match/create the vendor `company` (by
		// VAT-ID / IBAN / name) + its Ansprechpartner as a `person` that `represents` it, then emit the
		// ontology invoice (lines/payments) linked to the company via `billed_by` (janta.x4). The generic
		// persist loop writes the invoice (+ provenance); the `contact` output is vibe-only (not a type).
		enrichAddressbook: async ({ inputs }) => {
			const raw = inputs.invoice as Record<string, unknown> | undefined
			if (!raw) return {} // non-invoice path (e.g. bank statement) — follow-on
			const str = (v: unknown): string => (v == null ? '' : String(v))
			const header = (raw.header ?? {}) as Record<string, unknown>
			const totals = (raw.totals ?? {}) as Record<string, unknown>
			const vendor = (raw.vendor ?? {}) as Record<string, unknown>
			// The vision model scatters the same fact across paths — it fills EITHER the single `bank`
			// block OR `banking_accounts[]`, and often drops email/phone/tax into the `org_public_record`
			// imprint instead of the root. Harvest from EVERY path so nothing extracted is lost. board 0097.
			const bank = (vendor.bank ?? {}) as Record<string, unknown>
			const banking = (Array.isArray(vendor.banking_accounts) ? vendor.banking_accounts : []) as Record<string, unknown>[]
			const opr = (vendor.org_public_record ?? {}) as Record<string, unknown>
			const channels = (Array.isArray(opr.contact_channels) ? opr.contact_channels : []) as Record<string, unknown>[]
			const oprIds = (Array.isArray(opr.identifiers) ? opr.identifiers : []) as Record<string, unknown>[]
			const chan = (k: string): string => str(channels.find((c) => str(c.channel) === k)?.value)
			const oprId = (cat: string): string => str(oprIds.find((i) => str(i.category) === cat)?.value)
			const iban = str(banking[0]?.iban) || str(bank.iban)
			const vatId = str(vendor.tax_id) || oprId('vat_id') // USt-IdNr / VAT-ID
			const taxNumber = str(vendor.tax_number) || oprId('national_tax_number') // Steuernummer
			const name = str(vendor.name)
			const email = str(vendor.email) || chan('email')
			const phone = str(vendor.phone) || chan('phone')
			const postal = [str(vendor.street), [str(vendor.postal_code), str(vendor.city)].filter(Boolean).join(' '), str(vendor.country)]
				.filter(Boolean)
				.join(', ')
			// 1. match-or-create the vendor company (by VAT-ID / IBAN / name) — track HOW it matched and
			// WHAT was added, so the enrich vibe can highlight the addressbook change.
			const companies = ((await executeDataTool(uid, { schema: 'company', action: 'list' })) as { items: Record<string, unknown>[] }).items
			const matched = companies.find(
				(c) => (vatId && c.vat_id === vatId) || (iban && c.iban === iban) || (name && c.name === name)
			)
			const matchedBy =
				matched && vatId && matched.vat_id === vatId
					? 'VAT-ID'
					: matched && iban && matched.iban === iban
						? 'IBAN'
						: matched
							? 'Name'
							: undefined
			let companyId = matched?.id as string | undefined
			const isNew = !companyId
			const added: string[] = []
			if (!companyId && name) {
				const c = (await executeDataTool(uid, {
					schema: 'company',
					action: 'create',
					items: [{ name, email, phone, iban, vat_id: vatId, tax_number: taxNumber, postal }]
				})) as { created?: string[] }
				companyId = c.created?.[0]
				for (const [label, value] of [
					['Name', name],
					['E-Mail', email],
					['Telefon', phone],
					['IBAN', iban],
					['USt-IdNr', vatId],
					['Steuernummer', taxNumber],
					['Adresse', postal]
				] as const)
					if (value) added.push(label)
			} else if (companyId && matched) {
				// BACKFILL (board 0097): the company already exists but a later invoice extracted fields it was
				// missing (e.g. the first run had no IBAN, this one does). Patch only the EMPTY fields so a re-run
				// enriches rather than no-ops — the discriminated spec updates just that channel/id, never
				// clobbering a value already on file.
				const patch: Record<string, string> = {}
				for (const [field, label, value] of [
					['email', 'E-Mail', email],
					['phone', 'Telefon', phone],
					['iban', 'IBAN', iban],
					['vat_id', 'USt-IdNr', vatId],
					['tax_number', 'Steuernummer', taxNumber],
					['postal', 'Adresse', postal]
				] as const) {
					if (value && !str(matched[field])) {
						patch[field] = value
						added.push(label)
					}
				}
				if (Object.keys(patch).length > 0)
					await executeDataTool(uid, { schema: 'company', action: 'update', items: [{ id: companyId, ...patch }] })
			}
			// 2. Ansprechpartner: a person who REPRESENTS the company
			const contactName = str(vendor.contact_name)
			if (contactName && companyId) {
				const persons = ((await executeDataTool(uid, { schema: 'person', action: 'list' })) as { items: Record<string, unknown>[] }).items
				if (!persons.find((p) => p.name === contactName && p.represents === companyId)) {
					await executeDataTool(uid, { schema: 'person', action: 'create', items: [{ name: contactName, email, company: companyId }] })
				}
			}
			// 3. map the rich extraction → the ontology invoice (lines/payments), linked via billed_by
			const statements = (Array.isArray(raw.statements) ? raw.statements : []) as Record<string, unknown>[]
			const lines = statements
				.flatMap((s) => (Array.isArray(s.line_items) ? (s.line_items as Record<string, unknown>[]) : []))
				.map((li) => ({ description: str(li.description ?? li.title), quantity: str(li.quantity), unit_price: str(li.unit_price), amount: str(li.amount) }))
				.filter((l) => l.description || l.amount)
			const payments = ((Array.isArray(raw.payments) ? raw.payments : []) as Record<string, unknown>[])
				.map((p) => ({ amount: str(p.amount), date: str(p.date) }))
				.filter((p) => p.amount)
			return {
				invoice: {
					...raw, // keep the rich doctype for the vibe card
					artifact: str(raw.artifact),
					number: String(header.invoice_number ?? 'N/A'),
					total: totals.invoice_total != null ? String(totals.invoice_total) : '0',
					vendor: name,
					billed_by: companyId ?? '',
					due: str(header.due_date ?? header.issue_date),
					lines,
					payments
				},
				contact: {
					id: companyId,
					name,
					isNew,
					matchedBy,
					email: email || undefined,
					phone: phone || undefined,
					ust_id: vatId || undefined,
					tax_number: taxNumber || undefined,
					iban: iban || undefined,
					address: postal || undefined,
					ansprechpartner: contactName || undefined,
					added
				}
			}
		}
	}
}

/** Load a skill's Flow config from the admin `flow` table (Layer A). */
async function loadFlow(id: string): Promise<Flow | null> {
	const row = await db()
		.selectFrom('flow')
		.select(['id', 'name', 'description', 'nodes', 'edges', 'triggers', 'resource_labels'])
		.where('id', '=', id)
		.executeTakeFirst()
	if (!row) return null
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		nodes: asJson(row.nodes) as Flow['nodes'],
		edges: asJson(row.edges) as Flow['edges'],
		triggers: (asJson(row.triggers) as Flow['triggers']) ?? undefined,
		resourceLabels: (asJson(row.resource_labels) as Flow['resourceLabels']) ?? undefined
	}
}

/** Which flow's `extract_document` node holds the SSOT extraction config for a doctype. board 0093. */
const DOCTYPE_FLOW: Record<string, string> = { invoice: 'capture', bank_statement: 'capture-bank' }

/** The extraction config (system_prompt + tool-call schema) for a doctype, read from the flow node that
 *  extracts it — the board 0093 SSOT, replacing the old per-doctype registry lookup. Returns a Doctype-shaped
 *  object so existing extractors (e.g. the chat path's extractDocFields) consume it unchanged. */
export async function loadExtractConfig(
	doctype: string
): Promise<{ id: string; name: string; system_prompt: string; schema: Record<string, unknown> } | undefined> {
	const flowId = DOCTYPE_FLOW[doctype]
	if (!flowId) return undefined
	const flow = await loadFlow(flowId)
	const node = flow?.nodes.find((n) => n.actor === 'extract_document')
	if (!node?.system_prompt || !node.schema) return undefined
	return { id: doctype, name: doctype, system_prompt: node.system_prompt, schema: node.schema as Record<string, unknown> }
}

/** All skill Flow configs (for composite flowRef resolution via flattenFlow). */
async function loadAllFlows(): Promise<Flow[]> {
	const rows = await db()
		.selectFrom('flow')
		.select(['id', 'name', 'description', 'nodes', 'edges', 'triggers', 'resource_labels'])
		.execute()
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		description: row.description,
		nodes: asJson(row.nodes) as Flow['nodes'],
		edges: asJson(row.edges) as Flow['edges'],
		triggers: (asJson(row.triggers) as Flow['triggers']) ?? undefined,
		resourceLabels: (asJson(row.resource_labels) as Flow['resourceLabels']) ?? undefined
	}))
}

async function persistFlowRun(uid: string, run: FlowRun): Promise<void> {
	await db()
		.insertInto('flow_run')
		.values({
			id: run.id,
			user_id: uid,
			flow_id: run.flowId,
			label: run.label,
			status: run.status,
			trace: JSON.stringify(run.trace),
			started_at: run.startedAt ? new Date(run.startedAt) : null,
			created_at: new Date()
		})
		.execute()
}

export type RunSkillResult = {
	runId: string
	status: FlowRun['status']
	documentId: string | null
}

/** Run a skill end-to-end for a user: generic runner → artifact + document predications + provenance
 *  + persisted run trace. Reusable by the REST endpoint AND the chat `run_skill` tool. board 0089. */
export async function runSkillForUser(
	uid: string,
	skillId: string,
	input: SkillInput,
	onStep?: (step: TraceStep) => void
): Promise<RunSkillResult> {
	const flow = await loadFlow(skillId)
	if (!flow) throw new Error(`no skill "${skillId}"`)
	// Flatten composite (flowRef) steps so a skill can REUSE another skill — Invoice Processing reuses
	// doc-ingest (store + classify) then captures (extract + enrich). flattenFlow is a no-op when flat.
	const flat = flattenFlow(flow, await loadAllFlows())
	const runId = `run_${randomUUID().slice(0, 12)}`
	const { run, outputs } = await runFlow(flat, {
		actors: skillActors(pgArtifactStore(), uid),
		runId,
		now: () => new Date().toISOString(),
		input: { file: input, image: input },
		onStep // board 0091 — stream each step's vibe card to the caller (chat)
	})

	// GENERIC persistence: any output resource whose kind is a REGISTERED type (document/invoice/…) is
	// written via the 0088 engine, with the run id added so the krasi/finti provenance closes. board 0090.
	let documentId: string | null = null
	if (run.status === 'done') {
		for (const [kind, value] of Object.entries(outputs)) {
			if (!value || typeof value !== 'object') continue
			const spec = await loadTypeSpec(kind)
			if (!spec) continue
			const res = (await executeDataTool(uid, {
				schema: kind,
				action: 'create',
				items: [{ ...(value as Record<string, unknown>), run: runId }]
			})) as { created?: string[] }
			documentId = res.created?.[0] ?? documentId
		}
	}
	await persistFlowRun(uid, run)
	return { runId, status: run.status, documentId }
}

/** GET /api/skills/runs — the signed-in user's REAL persisted run traces (newest first). board 0090. */
export async function listRuns(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const rows = await db()
		.selectFrom('flow_run')
		.select(['id', 'flow_id', 'label', 'status', 'trace', 'started_at'])
		.where('user_id', '=', uid)
		.orderBy('created_at', 'desc')
		.execute()
	return c.json({
		runs: rows.map((r) => ({
			id: r.id,
			flowId: r.flow_id,
			label: r.label,
			status: r.status,
			startedAt: r.started_at ? new Date(r.started_at).toISOString() : undefined,
			trace: asJson(r.trace)
		}))
	})
}

/** POST /api/skills/:id/run — body { mime, b64 }. Runs the skill for the signed-in user. */
export async function runSkill(c: Context): Promise<Response> {
	const uid = await userId(c)
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'skill id required' }, 400)
	const body = (await c.req.json().catch(() => null)) as { mime?: string; b64?: string } | null
	if (!body?.b64 || !body.mime) return c.json({ error: 'body { mime, b64 } required' }, 400)
	const bytes = new Uint8Array(Buffer.from(body.b64, 'base64'))
	try {
		const out = await runSkillForUser(uid, id, { bytes, mime: body.mime })
		return c.json(out)
	} catch (e) {
		return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
	}
}
