import { randomUUID } from 'node:crypto'
import {
	type ActorRegistry,
	type ArtifactStore,
	type Flow,
	type FlowRun,
	runFlow
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

const INVOICE_EXTRACT_SCHEMA = {
	type: 'object',
	properties: {
		number: { type: 'string', description: 'The invoice number / identifier.' },
		amount: { type: 'string', description: 'The total amount as a decimal string, e.g. "1200.00".' },
		vendor: { type: 'string', description: 'The vendor / biller name.' },
		due: { type: 'string', description: 'The due date as ISO yyyy-mm-dd, or empty if none.' }
	},
	required: ['number', 'amount', 'vendor']
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
				document: {
					artifact: doc.artifact,
					title: fields.title,
					kind: fields.kind,
					summary: fields.summary
				}
			}
		},
		extract_invoice: async ({ node, inputs }) => {
			const doc = inputs.document as { artifact: string; mime: string; bytes: Uint8Array }
			const b64 = Buffer.from(doc.bytes).toString('base64')
			const sys =
				node.system_prompt ??
				'You are a bookkeeper. Extract the invoice fields: number, total amount as a decimal, vendor name, and due date (ISO yyyy-mm-dd).'
			const f = (await visionExtract(sys, INVOICE_EXTRACT_SCHEMA, { mime: doc.mime, b64 })) ?? {}
			return {
				invoice: {
					artifact: doc.artifact,
					number: f.number ?? 'unknown',
					amount: f.amount ?? '0',
					vendor: f.vendor ?? '',
					due: f.due ?? ''
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
	input: SkillInput
): Promise<RunSkillResult> {
	const flow = await loadFlow(skillId)
	if (!flow) throw new Error(`no skill "${skillId}"`)
	const runId = `run_${randomUUID().slice(0, 12)}`
	const { run, outputs } = await runFlow(flow, {
		actors: skillActors(pgArtifactStore()),
		runId,
		now: () => new Date().toISOString(),
		input: { file: input, image: input }
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
