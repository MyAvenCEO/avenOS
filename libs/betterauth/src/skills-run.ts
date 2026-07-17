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
import { crud, fetchOp } from './actor-run'

// Skill execution (board 0089). Loads a skill's Flow config from the admin `flow` table and runs it
// through the GENERIC runner, persisting any output whose kind is a registered type via the 0088
// engine + the run trace to `flow_run`. board 0099 stripped the document/finance actors with their
// verticals; the runner stays generic (register a flow-run skill's actors in `skillActors`).

async function userId(c: Context): Promise<string | null> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	return session?.user?.id ?? null
}

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

/** A skill input artifact: the raw bytes + mime of the file/photo to ingest. */
export type SkillInput = { bytes: Uint8Array; mime: string }

// board 0099 — the flow runner stays GENERIC. The document/finance actors were stripped with their
// verticals; the Todos skill is an ACTOR HUB driven through the chat's data_crud tool (see
// @avenos/skills/tools), not the flow runner. A new flow-run skill registers its actors here.
function skillActors(_store: ArtifactStore, _uid: string): ActorRegistry {
	return {}
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

/** board 0099 — record a ONE-actor run. The Todos hub executes via the chat `data_crud` tool (not the
 *  flow runner), so each todos action is persisted as a single-step `flow_run` of the `todos` hub — that
 *  is how the Runs explorer shows todos interactions as runs (one span per actor firing). */
export async function recordActorRun(
	uid: string,
	opts: {
		flowId: string
		nodeId: string
		label: string
		vibe?: string
		vibeData?: unknown
		inputs?: string[]
		outputs?: string[]
	}
): Promise<void> {
	const now = new Date().toISOString()
	const run: FlowRun = {
		id: `run_${randomUUID().slice(0, 12)}`,
		flowId: opts.flowId,
		label: opts.label,
		status: 'done',
		startedAt: now,
		trace: [
			{
				nodeId: opts.nodeId,
				state: 'done',
				at: now,
				inputs: opts.inputs ?? [],
				outputs: opts.outputs ?? [],
				vibe: opts.vibe,
				vibeData: opts.vibeData
			}
		]
	}
	await persistFlowRun(uid, run).catch((e) => console.error('[skills] recordActorRun failed:', e))
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

	// GENERIC persistence via the ONE operations engine (board 0112): a kind is persistable iff its
	// `<kind>.create` op is seeded in data_operations (mint-time seeding); the write is a plain crud().
	let documentId: string | null = null
	if (run.status === 'done') {
		for (const [kind, value] of Object.entries(outputs)) {
			if (!value || typeof value !== 'object') continue
			const persistable = await fetchOp(uid, `${kind}.create`).then(
				() => true,
				() => false
			)
			if (!persistable) continue
			const res = (await crud(uid, {
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
