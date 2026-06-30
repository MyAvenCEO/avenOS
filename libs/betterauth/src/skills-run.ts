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
import { getDoctype } from '@avenos/aven-vibes/doctypes'
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

/** The skills' actors, closing over the ArtifactStore. The `document` resource carries the bytes
 *  between ingest→classify/extract (for vision); only the sha256 is persisted to predications. The
 *  runner is GENERIC — adding a skill = adding an actor here (+ its config + ontology type). board 0089/0090. */
function skillActors(store: ArtifactStore): ActorRegistry {
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
					kind: fields.kind,
					summary: fields.summary
				}
			}
		},
		extract_invoice: async ({ inputs }) => {
			const doc = inputs.document as { artifact: string; mime: string; bytes: Uint8Array }
			const b64 = Buffer.from(doc.bytes).toString('base64')
			// Use the ORIGINAL working invoice doctype — its proven system prompt + rich tool-call schema
			// (header/vendor/totals/payments/statements). board 0064/0090.
			const doctype = getDoctype('invoice')
			const rich =
				(doctype ? await visionExtract(doctype.system_prompt, doctype.schema, { mime: doc.mime, b64 }) : null) ??
				{}
			const header = (rich.header ?? {}) as Record<string, unknown>
			const totals = (rich.totals ?? {}) as Record<string, unknown>
			const vendor = (rich.vendor ?? {}) as Record<string, unknown>
			// Map the rich extraction → the ontology invoice graph (board 0092): the headline PLUS the
			// nested line items (statements[].line_items[]) and payments[], so the 0088 engine persists
			// the full lines[]/payments[] sub-entities. The raw doctype is spread in too, so the invoice
			// vibe card (mapper.ts reads header/vendor/statements/totals) still renders the rich view.
			const str = (v: unknown): string => (v == null ? '' : String(v))
			const statements = (Array.isArray(rich.statements) ? rich.statements : []) as Record<string, unknown>[]
			const lines = statements
				.flatMap((s) => (Array.isArray(s.line_items) ? (s.line_items as Record<string, unknown>[]) : []))
				.map((li) => ({
					description: str(li.description ?? li.title),
					quantity: str(li.quantity),
					unit_price: str(li.unit_price),
					amount: str(li.amount)
				}))
				.filter((l) => l.description || l.amount)
			const payments = ((Array.isArray(rich.payments) ? rich.payments : []) as Record<string, unknown>[])
				.map((p) => ({ amount: str(p.amount), date: str(p.date) }))
				.filter((p) => p.amount)
			return {
				invoice: {
					...rich, // keep the rich doctype for the vibe view
					artifact: doc.artifact,
					number: String(header.invoice_number ?? 'N/A'),
					total: totals.invoice_total != null ? String(totals.invoice_total) : '0',
					vendor: String(vendor.name ?? ''),
					due: String(header.due_date ?? header.issue_date ?? ''),
					lines,
					payments
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
	// Flatten composite (flowRef) steps so a skill can REUSE another skill — invoice-ingest reuses
	// doc-ingest (store + classify) then extracts. flattenFlow is a no-op for already-flat flows.
	const flat = flattenFlow(flow, await loadAllFlows())
	const runId = `run_${randomUUID().slice(0, 12)}`
	const { run, outputs } = await runFlow(flat, {
		actors: skillActors(pgArtifactStore()),
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
